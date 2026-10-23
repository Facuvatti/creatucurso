// Tutor/creator <-> student chat (ADR-0032, ADR-0010).
//
// The rule, enforced by `PAIRS` on every start, list, open, send, read and
// download: a conversation exists only between a student with an ACTIVE
// enrollment in a course and a staff person of that course (a tutor assigned to
// it, or an owner/admin of the academy acting as the creator). A student can
// never talk to another student, and a tutor never talks about a course they are
// not assigned to. Every call receives the tenant that came from the request
// Host, so a person enrolled in academy A has nothing in academy B.
//
// Messages are private to the two participants. Owners and admins have no way
// to read the conversations of others.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inTransaction, pool } from "../../server/db.server.ts";
import type {
	ChatContact,
	ChatEvent,
	ChatMessage,
	ConversationSummary,
} from "./types.ts";

const run = promisify(execFile);

export const MESSAGE_MAX_LENGTH = 4000;
const PAGE_SIZE = 50;
const MESSAGES_PER_MINUTE = 20;
const TOOL_TIMEOUT_MS = 30_000;
const DENIED = "No tenés acceso a esta conversación.";

export function attachmentMaxBytes(): number {
	return Number(process.env.CHAT_ATTACHMENT_MAX_BYTES ?? 5 * 1024 * 1024);
}

// ------------------------------------------------------------ real-time events
// One plain in-process emitter (ADR-0010, ADR-0032): it works while there is a
// single web process. With more than one process this is replaced by Postgres
// LISTEN/NOTIFY. It hangs off globalThis so a dev-server module reload keeps
// the open streams attached to the emitter that senders use.
const shared = globalThis as typeof globalThis & {
	__chatEvents?: EventEmitter;
};
if (!shared.__chatEvents) {
	shared.__chatEvents = new EventEmitter().setMaxListeners(0);
}
const emitter = shared.__chatEvents;

/** Calls `listener` for each message addressed to this person. Returns the unsubscribe function. */
export function subscribe(
	userId: string,
	listener: (event: ChatEvent) => void,
): () => void {
	emitter.on(`user:${userId}`, listener);
	return () => {
		emitter.off(`user:${userId}`, listener);
	};
}

// ------------------------------------------------------------- authorization

// Every (course, student, staff) triple allowed to talk in the academy $1.
// Staff of a course = its tutors (role tutor AND assigned) plus the owners and
// admins of the academy. The student needs an `active` enrollment (refunded,
// suspended and revoked ones cannot chat) and to be a member of the academy.
const PAIRS = `
	select c.id as course_id, c.name as course_name,
	       e.user_id as student_id, s.user_id as staff_id
	from catalog.course c
	join catalog.enrollment e on e.course_id = c.id and e.status = 'active'
	join auth.member sm on sm."organizationId" = c.organization_id and sm."userId" = e.user_id
	join (
		select i.course_id, i.user_id
		from catalog.course_instructor i
		join catalog.course ic on ic.id = i.course_id
		join auth.member m on m."organizationId" = ic.organization_id and m."userId" = i.user_id
		where (',' || m.role || ',') like '%,tutor,%'
		union
		select oc.id, m."userId"
		from catalog.course oc
		join auth.member m on m."organizationId" = oc.organization_id
		where (',' || m.role || ',') like '%,owner,%' or (',' || m.role || ',') like '%,admin,%'
	) s on s.course_id = c.id
	where c.organization_id = $1 and e.user_id <> s.user_id`;

async function canChat(
	organizationId: string,
	courseId: string,
	studentId: string,
	staffId: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`with pair as (${PAIRS})
		 select 1 from pair where course_id = $2 and student_id = $3 and staff_id = $4`,
		[organizationId, courseId, studentId, staffId],
	);
	return (rowCount ?? 0) > 0;
}

type Conversation = {
	id: string;
	courseId: string;
	studentId: string;
	staffId: string;
};

/** The conversation when the person takes part in it AND the pair is still allowed, else null. */
async function findConversation(
	organizationId: string,
	userId: string,
	conversationId: string,
): Promise<Conversation | null> {
	const { rows } = await pool.query<{
		id: string;
		course_id: string;
		student_id: string;
		staff_id: string;
	}>(
		`with pair as (${PAIRS})
		 select cv.id, cv.course_id, cv.student_id, cv.staff_id
		 from chat.conversation cv
		 join pair p on p.course_id = cv.course_id and p.student_id = cv.student_id
		            and p.staff_id = cv.staff_id
		 where cv.id = $2 and cv.organization_id = $1
		   and (cv.student_id = $3 or cv.staff_id = $3)`,
		[organizationId, conversationId, userId],
	);
	const row = rows[0];
	return row
		? {
				id: row.id,
				courseId: row.course_id,
				studentId: row.student_id,
				staffId: row.staff_id,
			}
		: null;
}

// ----------------------------------------------------------------- contacts

/** The people this person may start a conversation with, optionally filtered by name. */
export async function listContacts(
	organizationId: string,
	userId: string,
	search: string,
): Promise<ChatContact[]> {
	const { rows } = await pool.query<{
		course_id: string;
		course_name: string;
		user_id: string;
		name: string;
		kind: "student" | "staff";
	}>(
		`with pair as (${PAIRS})
		 select p.course_id, p.course_name, u.id as user_id, u.name,
		        case when p.student_id = $2 then 'staff' else 'student' end as kind
		 from pair p
		 join auth."user" u on u.id = case when p.student_id = $2 then p.staff_id else p.student_id end
		 where (p.student_id = $2 or p.staff_id = $2)
		   and ($3 = '' or position(lower($3) in lower(u.name)) > 0)
		 order by p.course_name, u.name
		 limit 100`,
		[organizationId, userId, search.trim()],
	);
	return rows.map((row) => ({
		courseId: row.course_id,
		courseName: row.course_name,
		userId: row.user_id,
		name: row.name,
		is: row.kind,
	}));
}

/** Finds or creates the conversation between the caller and `otherUserId` for a course. Null when not allowed. */
export async function openConversation(
	organizationId: string,
	userId: string,
	courseId: string,
	otherUserId: string,
): Promise<string | null> {
	let studentId = userId;
	let staffId = otherUserId;
	if (!(await canChat(organizationId, courseId, studentId, staffId))) {
		studentId = otherUserId;
		staffId = userId;
		if (!(await canChat(organizationId, courseId, studentId, staffId))) {
			return null;
		}
	}
	const { rows } = await pool.query<{ id: string }>(
		`insert into chat.conversation (organization_id, course_id, student_id, staff_id)
		 values ($1, $2, $3, $4)
		 on conflict (course_id, student_id, staff_id)
		 do update set organization_id = excluded.organization_id
		 returning id`,
		[organizationId, courseId, studentId, staffId],
	);
	return rows[0]?.id ?? null;
}

// ------------------------------------------------------------ conversations

export async function listConversations(
	organizationId: string,
	userId: string,
): Promise<ConversationSummary[]> {
	const { rows } = await pool.query<{
		id: string;
		course_id: string;
		course_name: string;
		other_id: string;
		other_name: string;
		other_is: "student" | "staff";
		last_message_at: Date;
		last_body: string | null;
		last_has_attachment: boolean | null;
		unread: string;
	}>(
		`with pair as (${PAIRS})
		 select cv.id, cv.course_id, p.course_name, u.id as other_id, u.name as other_name,
		        case when cv.student_id = $2 then 'staff' else 'student' end as other_is,
		        cv.last_message_at, lm.body as last_body,
		        (lm.attachment_path is not null) as last_has_attachment,
		        (select count(*) from chat.message m
		         where m.conversation_id = cv.id and m.sender_id <> $2
		           and m.created_at > coalesce(
		             (select r.last_read_at from chat.read_position r
		              where r.conversation_id = cv.id and r.user_id = $2),
		             '-infinity')) as unread
		 from chat.conversation cv
		 join pair p on p.course_id = cv.course_id and p.student_id = cv.student_id
		            and p.staff_id = cv.staff_id
		 join auth."user" u on u.id = case when cv.student_id = $2 then cv.staff_id else cv.student_id end
		 left join lateral (
			select m.body, m.attachment_path from chat.message m
			where m.conversation_id = cv.id order by m.created_at desc limit 1
		 ) lm on true
		 where cv.organization_id = $1 and (cv.student_id = $2 or cv.staff_id = $2)
		 order by cv.last_message_at desc
		 limit 200`,
		[organizationId, userId],
	);
	return rows.map((row) => ({
		id: row.id,
		courseId: row.course_id,
		courseName: row.course_name,
		otherUserId: row.other_id,
		otherName: row.other_name,
		otherIs: row.other_is,
		lastMessageAt: row.last_message_at.toISOString(),
		lastBody: row.last_body ?? "",
		lastHasAttachment: row.last_has_attachment ?? false,
		unread: Number(row.unread),
	}));
}

// ----------------------------------------------------------------- messages

type MessageRow = {
	id: string;
	conversation_id: string;
	sender_id: string;
	body: string;
	attachment_name: string | null;
	attachment_type: string | null;
	created_at: Date;
};

const MESSAGE_COLUMNS = `id, conversation_id, sender_id, body, attachment_name, attachment_type, created_at`;

const toMessage = (row: MessageRow): ChatMessage => ({
	id: row.id,
	conversationId: row.conversation_id,
	senderId: row.sender_id,
	body: row.body,
	attachment:
		row.attachment_name && row.attachment_type
			? {
					name: row.attachment_name,
					type: row.attachment_type,
					url: `/api/chat/attachment/${row.id}`,
				}
			: null,
	createdAt: row.created_at.toISOString(),
});

/** One page of messages, oldest first. `beforeId` loads the page before that message. Null when not allowed. */
export async function listMessages(
	organizationId: string,
	userId: string,
	conversationId: string,
	beforeId: string | null,
): Promise<{ messages: ChatMessage[]; hasMore: boolean } | null> {
	if (!(await findConversation(organizationId, userId, conversationId))) {
		return null;
	}
	const { rows } = await pool.query<MessageRow>(
		`select ${MESSAGE_COLUMNS} from chat.message
		 where conversation_id = $1
		   and ($2::uuid is null
		        or created_at < (select created_at from chat.message where id = $2 and conversation_id = $1))
		 order by created_at desc
		 limit $3`,
		[conversationId, beforeId, PAGE_SIZE + 1],
	);
	return {
		messages: rows.slice(0, PAGE_SIZE).map(toMessage).reverse(),
		hasMore: rows.length > PAGE_SIZE,
	};
}

export async function markRead(
	organizationId: string,
	userId: string,
	conversationId: string,
): Promise<boolean> {
	if (!(await findConversation(organizationId, userId, conversationId))) {
		return false;
	}
	await pool.query(
		`insert into chat.read_position (conversation_id, user_id, last_read_at)
		 values ($1, $2, now())
		 on conflict (conversation_id, user_id)
		 do update set last_read_at = greatest(chat.read_position.last_read_at, excluded.last_read_at)`,
		[conversationId, userId],
	);
	return true;
}

export type SendResult =
	| { ok: true; message: ChatMessage }
	| { ok: false; message: string };

/** Stores a message and pushes it to both participants' open streams. */
export async function sendMessage(
	organizationId: string,
	userId: string,
	conversationId: string,
	input: { body: string; file?: { bytes: Buffer; name: string } },
): Promise<SendResult> {
	const body = input.body.trim();
	if (body.length > MESSAGE_MAX_LENGTH) {
		return { ok: false, message: "El mensaje es demasiado largo." };
	}
	if (!body && !input.file) {
		return { ok: false, message: "Escribí un mensaje o adjuntá un archivo." };
	}
	const conversation = await findConversation(
		organizationId,
		userId,
		conversationId,
	);
	if (!conversation) return { ok: false, message: DENIED };

	const { rows: recent } = await pool.query<{ count: string }>(
		`select count(*) from chat.message
		 where sender_id = $1 and created_at > now() - interval '1 minute'`,
		[userId],
	);
	if (Number(recent[0]?.count ?? 0) >= MESSAGES_PER_MINUTE) {
		return {
			ok: false,
			message: "Estás enviando muchos mensajes. Esperá un momento.",
		};
	}

	const id = randomUUID();
	let attachment: {
		path: string;
		name: string;
		type: string;
	} | null = null;
	if (input.file) {
		const prepared = await prepareAttachment(input.file.bytes, input.file.name);
		if (!prepared.ok) return prepared;
		const relative = path.join(
			"chat",
			conversationId,
			`${id}.${prepared.extension}`,
		);
		await mkdir(path.dirname(path.join(mediaRoot(), relative)), {
			recursive: true,
		});
		await writeFile(path.join(mediaRoot(), relative), prepared.bytes);
		attachment = { path: relative, name: prepared.name, type: prepared.type };
	}

	let row: MessageRow;
	try {
		row = await inTransaction(async (client) => {
			const { rows } = await client.query<MessageRow>(
				`insert into chat.message
				   (id, conversation_id, sender_id, body, attachment_path, attachment_name, attachment_type)
				 values ($1, $2, $3, $4, $5, $6, $7)
				 returning ${MESSAGE_COLUMNS}`,
				[
					id,
					conversationId,
					userId,
					body,
					attachment?.path ?? null,
					attachment?.name ?? null,
					attachment?.type ?? null,
				],
			);
			const created = rows[0] as MessageRow;
			await client.query(
				`update chat.conversation set last_message_at = $2 where id = $1`,
				[conversationId, created.created_at],
			);
			// What you send is read by you.
			await client.query(
				`insert into chat.read_position (conversation_id, user_id, last_read_at)
				 values ($1, $2, $3)
				 on conflict (conversation_id, user_id)
				 do update set last_read_at = greatest(chat.read_position.last_read_at, excluded.last_read_at)`,
				[conversationId, userId, created.created_at],
			);
			return created;
		});
	} catch (error) {
		if (attachment) await unlink(path.join(mediaRoot(), attachment.path));
		throw error;
	}

	const message = toMessage(row);
	const event: ChatEvent = { organizationId, conversationId, message };
	// Both participants: the other person's screen and the sender's other tabs.
	emitter.emit(`user:${conversation.studentId}`, event);
	emitter.emit(`user:${conversation.staffId}`, event);
	return { ok: true, message };
}

// -------------------------------------------------------------- attachments
// Stored under MEDIA_ROOT/chat/<conversationId>/<messageId>.<ext>. That folder
// is not served by nginx (ADR-0020 only serves uploads/hls through signed URLs);
// the only way out is `readAttachment` behind the participant check.

function mediaRoot(): string {
	return path.resolve(process.env.MEDIA_ROOT ?? "./media-data");
}

function detectType(bytes: Buffer): "pdf" | "png" | "jpeg" | null {
	if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
	if (
		bytes.length > 8 &&
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		return "png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "jpeg";
	}
	return null;
}

function cleanName(raw: string): string {
	const base = path.basename(raw.replaceAll("\\", "/"));
	const printable = [...base]
		.filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
		.join("")
		.trim();
	return printable.slice(0, 120) || "archivo";
}

type Prepared =
	| {
			ok: true;
			bytes: Buffer;
			type: string;
			extension: string;
			name: string;
	  }
	| { ok: false; message: string };

/**
 * Real type from the magic bytes (the browser's type and the file name are not
 * trusted). Images are re-encoded with ffmpeg without metadata and at most 2000
 * px wide, so nothing from the uploaded file survives; a PDF is stored as sent
 * and only ever downloaded as an attachment.
 */
async function prepareAttachment(
	bytes: Buffer,
	rawName: string,
): Promise<Prepared> {
	if (bytes.length === 0) {
		return { ok: false, message: "El archivo está vacío." };
	}
	if (bytes.length > attachmentMaxBytes()) {
		return {
			ok: false,
			message: `El archivo pesa más de ${Math.floor(attachmentMaxBytes() / (1024 * 1024))} MB.`,
		};
	}
	const type = detectType(bytes);
	if (!type) {
		return {
			ok: false,
			message: "Adjuntá una imagen PNG o JPEG, o un PDF.",
		};
	}
	const name = cleanName(rawName);
	if (type === "pdf") {
		return { ok: true, bytes, type: "application/pdf", extension: "pdf", name };
	}

	const extension = type === "png" ? "png" : "jpg";
	const dir = await mkdtemp(path.join(tmpdir(), "chat-"));
	try {
		const input = path.join(dir, `in.${extension}`);
		const output = path.join(dir, `out.${extension}`);
		await writeFile(input, bytes);
		await run(
			"ffmpeg",
			[
				"-v",
				"error",
				"-y",
				"-i",
				input,
				"-frames:v",
				"1",
				"-map_metadata",
				"-1",
				"-vf",
				"scale='min(2000,iw)':-2",
				...(type === "jpeg" ? ["-q:v", "3"] : []),
				output,
			],
			{ timeout: TOOL_TIMEOUT_MS },
		);
		return {
			ok: true,
			bytes: await readFile(output),
			type: type === "png" ? "image/png" : "image/jpeg",
			extension,
			name,
		};
	} catch {
		return {
			ok: false,
			message: "No se pudo procesar la imagen. Puede estar dañada.",
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** The attachment of a message for a participant of its conversation, or null. */
export async function readAttachment(
	organizationId: string,
	userId: string,
	messageId: string,
): Promise<{ bytes: Buffer; name: string; type: string } | null> {
	const { rows } = await pool.query<{
		conversation_id: string;
		attachment_path: string;
		attachment_name: string;
		attachment_type: string;
	}>(
		`select conversation_id, attachment_path, attachment_name, attachment_type
		 from chat.message where id = $1 and attachment_path is not null`,
		[messageId],
	);
	const row = rows[0];
	if (!row) return null;
	if (!(await findConversation(organizationId, userId, row.conversation_id))) {
		return null;
	}
	const root = path.join(mediaRoot(), "chat");
	const file = path.resolve(mediaRoot(), row.attachment_path);
	if (!file.startsWith(`${root}${path.sep}`)) return null;
	try {
		return {
			bytes: await readFile(file),
			name: row.attachment_name,
			type: row.attachment_type,
		};
	} catch {
		return null;
	}
}
