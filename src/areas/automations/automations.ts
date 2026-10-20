// Automations (ADR-0026): the creator's definitions, their attachments and the
// delivery log. Sending lives in delivery.ts.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../server/db.server.ts";
import { TRIGGERS, type Trigger } from "./template.ts";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export type Attachment = { id: string; filename: string; bytes: number };

export type Automation = {
	id: string;
	courseId: string | null;
	courseName: string | null;
	trigger: Trigger;
	name: string;
	subject: string;
	body: string;
	attachCertificate: boolean;
	enabled: boolean;
	attachments: Attachment[];
};

export type AutomationInput = {
	courseId: string | null;
	trigger: Trigger;
	name: string;
	subject: string;
	body: string;
	attachCertificate: boolean;
};

export type DeliveryRow = {
	id: string;
	automationName: string;
	email: string;
	status: "pending" | "sent" | "failed" | "skipped";
	lastError: string | null;
	createdAt: string;
	sentAt: string | null;
};

type Result = { ok: true } | { ok: false; message: string };

export function mediaRoot(): string {
	return path.resolve(process.env.MEDIA_ROOT ?? "./media-data");
}

// ---------------------------------------------------------------- definitions

export async function listAutomations(
	organizationId: string,
): Promise<Automation[]> {
	const { rows } = await pool.query<{
		id: string;
		course_id: string | null;
		course_name: string | null;
		trigger: Trigger;
		name: string;
		subject: string;
		body: string;
		attach_certificate: boolean;
		enabled: boolean;
		attachments: Attachment[];
	}>(
		`select a.id, a.course_id, c.name as course_name, a.trigger, a.name, a.subject,
		        a.body, a.attach_certificate, a.enabled,
		        coalesce((select json_agg(json_build_object('id', t.id, 'filename', t.filename, 'bytes', t.bytes) order by t.filename)
		                  from automations.automation_attachment t where t.automation_id = a.id), '[]') as attachments
		 from automations.automation a
		 left join catalog.course c on c.id = a.course_id
		 where a.organization_id = $1
		 order by a.created_at`,
		[organizationId],
	);
	return rows.map((r) => ({
		id: r.id,
		courseId: r.course_id,
		courseName: r.course_name,
		trigger: r.trigger,
		name: r.name,
		subject: r.subject,
		body: r.body,
		attachCertificate: r.attach_certificate,
		enabled: r.enabled,
		attachments: r.attachments,
	}));
}

/** Creates (id null) or updates an automation of the academy. */
export async function saveAutomation(
	organizationId: string,
	id: string | null,
	input: AutomationInput,
): Promise<Result & { id?: string }> {
	if (!TRIGGERS.includes(input.trigger)) {
		return { ok: false, message: "Momento inválido." };
	}
	if (input.courseId) {
		const { rowCount } = await pool.query(
			"select 1 from catalog.course where id = $1 and organization_id = $2",
			[input.courseId, organizationId],
		);
		if (!rowCount) return { ok: false, message: "No encontramos el curso." };
	}
	const attachCertificate =
		input.attachCertificate && input.trigger === "course.completed";
	if (id) {
		const { rowCount } = await pool.query(
			`update automations.automation
			 set course_id = $3, trigger = $4, name = $5, subject = $6, body = $7,
			     attach_certificate = $8, updated_at = now()
			 where id = $1 and organization_id = $2`,
			[
				id,
				organizationId,
				input.courseId,
				input.trigger,
				input.name,
				input.subject,
				input.body,
				attachCertificate,
			],
		);
		return rowCount ? { ok: true, id } : { ok: false, message: "No existe." };
	}
	const { rows } = await pool.query<{ id: string }>(
		`insert into automations.automation
		   (organization_id, course_id, trigger, name, subject, body, attach_certificate)
		 values ($1, $2, $3, $4, $5, $6, $7) returning id`,
		[
			organizationId,
			input.courseId,
			input.trigger,
			input.name,
			input.subject,
			input.body,
			attachCertificate,
		],
	);
	return { ok: true, id: rows[0]?.id as string };
}

export async function setAutomationEnabled(
	organizationId: string,
	id: string,
	enabled: boolean,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"update automations.automation set enabled = $3, updated_at = now() where id = $1 and organization_id = $2",
		[id, organizationId, enabled],
	);
	return (rowCount ?? 0) > 0;
}

export async function deleteAutomation(
	organizationId: string,
	id: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"delete from automations.automation where id = $1 and organization_id = $2",
		[id, organizationId],
	);
	if (rowCount) {
		await rm(path.join(mediaRoot(), "automations", organizationId, id), {
			recursive: true,
			force: true,
		});
	}
	return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------- attachments

const startsWith = (bytes: Buffer, magic: number[]) =>
	magic.every((b, i) => bytes[i] === b);

const TYPES: Record<
	string,
	{ contentType: string; check: (bytes: Buffer) => boolean }
> = {
	pdf: {
		contentType: "application/pdf",
		check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]),
	},
	png: {
		contentType: "image/png",
		check: (b) =>
			startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	},
	jpg: {
		contentType: "image/jpeg",
		check: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
	},
	jpeg: {
		contentType: "image/jpeg",
		check: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
	},
	zip: {
		contentType: "application/zip",
		check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
	},
	docx: {
		contentType:
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
	},
	xlsx: {
		contentType:
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
	},
	// Plain text: no NUL bytes, which also rejects binaries renamed to .txt.
	txt: { contentType: "text/plain", check: (b) => !b.includes(0) },
};

/** Keeps a safe file name: no path, only letters, digits, dot, dash, underscore and space. */
export function sanitizeFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? "";
	const clean = base
		.normalize("NFKD")
		.replace(/[^\w. -]/g, "_")
		.replace(/^\.+/, "")
		.slice(-100);
	return clean || "archivo";
}

/** Validates and stores one attachment of an automation of the academy. */
export async function addAttachment(
	organizationId: string,
	automationId: string,
	rawFilename: string,
	bytes: Buffer,
): Promise<Result> {
	const { rowCount } = await pool.query(
		"select 1 from automations.automation where id = $1 and organization_id = $2",
		[automationId, organizationId],
	);
	if (!rowCount)
		return { ok: false, message: "No encontramos la automatización." };

	const filename = sanitizeFilename(rawFilename);
	const type = TYPES[filename.split(".").pop()?.toLowerCase() ?? ""];
	if (!type || !type.check(bytes)) {
		return {
			ok: false,
			message:
				"Ese tipo de archivo no está permitido. Podés adjuntar PDF, PNG, JPEG, ZIP, DOCX, XLSX o TXT.",
		};
	}
	if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
		return { ok: false, message: "Cada archivo puede pesar hasta 10 MB." };
	}
	const { rows } = await pool.query<{ n: string; total: string }>(
		`select count(*) as n, coalesce(sum(bytes), 0) as total
		 from automations.automation_attachment where automation_id = $1`,
		[automationId],
	);
	if (Number(rows[0]?.n) >= MAX_FILES) {
		return { ok: false, message: "Podés adjuntar hasta 5 archivos." };
	}
	if (Number(rows[0]?.total) + bytes.length > MAX_TOTAL_BYTES) {
		return {
			ok: false,
			message: "Los adjuntos no pueden superar los 15 MB en total.",
		};
	}

	const id = randomUUID();
	const relative = path.join(
		"automations",
		organizationId,
		automationId,
		`${id}-${filename}`,
	);
	const absolute = path.join(mediaRoot(), relative);
	await mkdir(path.dirname(absolute), { recursive: true });
	await writeFile(absolute, bytes);
	await pool.query(
		`insert into automations.automation_attachment (id, automation_id, filename, content_type, bytes, path)
		 values ($1, $2, $3, $4, $5, $6)`,
		[id, automationId, filename, type.contentType, bytes.length, relative],
	);
	return { ok: true };
}

export async function removeAttachment(
	organizationId: string,
	attachmentId: string,
): Promise<boolean> {
	const { rows } = await pool.query<{ path: string }>(
		`delete from automations.automation_attachment t
		 using automations.automation a
		 where t.id = $1 and a.id = t.automation_id and a.organization_id = $2
		 returning t.path`,
		[attachmentId, organizationId],
	);
	if (!rows[0]) return false;
	await rm(path.join(mediaRoot(), rows[0].path), { force: true });
	return true;
}

// ------------------------------------------------------------------------ log

export async function listDeliveries(
	organizationId: string,
): Promise<DeliveryRow[]> {
	const { rows } = await pool.query<{
		id: string;
		name: string;
		email: string;
		status: DeliveryRow["status"];
		last_error: string | null;
		created_at: Date;
		sent_at: Date | null;
	}>(
		`select d.id, a.name, d.email, d.status, d.last_error, d.created_at, d.sent_at
		 from automations.message_delivery d
		 join automations.automation a on a.id = d.automation_id
		 where d.organization_id = $1
		 order by d.created_at desc limit 100`,
		[organizationId],
	);
	return rows.map((r) => ({
		id: r.id,
		automationName: r.name,
		email: r.email,
		status: r.status,
		lastError: r.last_error,
		createdAt: r.created_at.toISOString(),
		sentAt: r.sent_at?.toISOString() ?? null,
	}));
}
