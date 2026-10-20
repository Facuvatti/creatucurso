// Sending of automation emails (ADR-0026): one delivery row per (outbox event,
// automation), sent with sendEmail, retried with backoff, limited per academy
// and per recipient, and skipped for unsubscribed or suppressed addresses.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../server/db.server.ts";
import { sendEmail } from "../../server/email.server.ts";
import { log } from "../../server/log.server.ts";
import { tenantOrigin } from "../../server/origins.server.ts";
import { readCertificatePdf } from "../certificates/certificates.ts";
import { mediaRoot } from "./automations.ts";
import {
	escapeHtmlText,
	renderHtmlBody,
	renderSubject,
	renderText,
	type Variables,
} from "./template.ts";

// Limits per academy and per recipient. Over a cap the delivery stays pending.
const MAX_PER_HOUR = 200;
const DEFAULT_MAX_PER_DAY = 2000;
const MAX_PER_RECIPIENT_PER_DAY = 5;
const MAX_ATTEMPTS = 5;
const DEFER_SECONDS = 600;
const PAUSED_DEFER_SECONDS = 3600;
const LEASE_SECONDS = 300;
const BATCH = 50;

type Attachment = { filename: string; content: Buffer };

// ------------------------------------------------------------- unsubscribe

function tokenKey(): Buffer {
	const key = process.env.SECRETS_ENCRYPTION_KEY;
	if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return createHmac("sha256", key).update("email-unsubscribe").digest();
}

function sign(payload: string): string {
	return createHmac("sha256", tokenKey()).update(payload).digest("base64url");
}

/** Signed token for "<academy>|<email>"; it has no expiry (a link in an old email must keep working). */
export function unsubscribeToken(
	organizationId: string,
	email: string,
): string {
	const payload = Buffer.from(
		`${organizationId}|${email.toLowerCase()}`,
	).toString("base64url");
	return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(
	token: string,
): { organizationId: string; email: string } | null {
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra !== undefined) return null;
	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return null;
	}
	const [organizationId, email] = Buffer.from(payload, "base64url")
		.toString()
		.split("|");
	return organizationId && email ? { organizationId, email } : null;
}

export async function recordUnsubscribe(
	organizationId: string,
	email: string,
): Promise<void> {
	await pool.query(
		`insert into automations.email_unsubscribe (organization_id, email)
		 values ($1, $2) on conflict do nothing`,
		[organizationId, email.toLowerCase()],
	);
}

// ----------------------------------------------------------------- message

function buildMessage(
	values: Variables,
	template: { subject: string; body: string },
	unsubscribeUrl: string,
) {
	const text = `${renderText(template.body, values)}\n\n--\n${values.academyName}\nDejar de recibir estos mensajes: ${unsubscribeUrl}\n`;
	const html = `<div>${renderHtmlBody(template.body, values)}</div><hr><p style="font-size:12px;color:#666">${escapeHtmlText(values.academyName)}<br><a href="${unsubscribeUrl}">Dejar de recibir estos mensajes</a></p>`;
	return {
		subject: renderSubject(template.subject, values),
		text,
		html,
		headers: {
			"List-Unsubscribe": `<${unsubscribeUrl}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	};
}

async function readStoredAttachments(
	automationId: string,
): Promise<Attachment[]> {
	const { rows } = await pool.query<{ filename: string; path: string }>(
		"select filename, path from automations.automation_attachment where automation_id = $1 order by filename",
		[automationId],
	);
	return Promise.all(
		rows.map(async (r) => ({
			filename: r.filename,
			content: await readFile(path.join(mediaRoot(), r.path)),
		})),
	);
}

// ----------------------------------------------------------------- limits

type Capacity =
	| { ok: true }
	| { ok: false; reason: string; retryInSeconds: number };

/** Whether the academy may send one more automated email now. */
async function academyCapacity(organizationId: string): Promise<Capacity> {
	const { rows } = await pool.query<{
		status: string | null;
		daily_limit: number | null;
		hour: string;
		day: string;
	}>(
		`select s.status, s.daily_limit,
		        (select count(*) from automations.message_delivery d
		          where d.organization_id = $1 and d.status = 'sent' and d.sent_at > now() - interval '1 hour') as hour,
		        (select count(*) from automations.message_delivery d
		          where d.organization_id = $1 and d.status = 'sent' and d.sent_at > now() - interval '1 day') as day
		 from (select 1) x left join automations.sending s on s.organization_id = $1`,
		[organizationId],
	);
	const r = rows[0];
	if (r?.status === "paused") {
		return {
			ok: false,
			reason: "paused",
			retryInSeconds: PAUSED_DEFER_SECONDS,
		};
	}
	if (Number(r?.hour) >= MAX_PER_HOUR) {
		return { ok: false, reason: "hour-cap", retryInSeconds: DEFER_SECONDS };
	}
	if (Number(r?.day) >= (r?.daily_limit ?? DEFAULT_MAX_PER_DAY)) {
		return { ok: false, reason: "day-cap", retryInSeconds: DEFER_SECONDS };
	}
	return { ok: true };
}

// ----------------------------------------------------------------- delivery

type Delivery = {
	id: string;
	organization_id: string;
	automation_id: string;
	course_id: string;
	enrollment_id: string | null;
	user_id: string;
	email: string;
	attempts: number;
};

/** Error code stored in the log: never the provider's response body. */
function errorCode(error: unknown): string {
	const status = String(error).match(/\((\d{3})\)/)?.[1];
	return status ? `provider-${status}` : "send-failed";
}

async function finish(
	id: string,
	status: "sent" | "skipped" | "failed",
	code: string | null,
	messageId: string | null = null,
) {
	await pool.query(
		`update automations.message_delivery
		 set status = $2, last_error = $3, provider_message_id = $4,
		     sent_at = case when $2 = 'sent' then now() else sent_at end
		 where id = $1`,
		[id, status, code, messageId],
	);
}

async function defer(id: string, code: string, seconds: number) {
	await pool.query(
		`update automations.message_delivery
		 set last_error = $2, next_attempt_at = now() + make_interval(secs => $3)
		 where id = $1`,
		[id, code, seconds],
	);
}

async function sendOne(d: Delivery): Promise<void> {
	const { rows } = await pool.query<{
		enabled: boolean;
		subject: string;
		body: string;
		attach_certificate: boolean;
		academy: string;
		slug: string;
		student: string;
		course: string;
		enrollment_active: boolean | null;
		unsubscribed: boolean;
		suppressed: boolean;
		recipient_sent: string;
	}>(
		`select a.enabled, a.subject, a.body, a.attach_certificate,
		        o.name as academy, o.slug, u.name as student, c.name as course,
		        (select e.status = 'active' from catalog.enrollment e where e.id = $2) as enrollment_active,
		        exists (select 1 from automations.email_unsubscribe x where x.organization_id = $3 and x.email = $4) as unsubscribed,
		        exists (select 1 from automations.suppression s where s.email = $4) as suppressed,
		        (select count(*) from automations.message_delivery m
		          where m.organization_id = $3 and m.email = $4 and m.status = 'sent'
		            and m.sent_at > now() - interval '1 day') as recipient_sent
		 from automations.automation a
		 join auth.organization o on o.id = a.organization_id
		 join auth."user" u on u.id = $5
		 join catalog.course c on c.id = $6 and c.organization_id = a.organization_id
		 where a.id = $1 and a.organization_id = $3`,
		[
			d.automation_id,
			d.enrollment_id,
			d.organization_id,
			d.email,
			d.user_id,
			d.course_id,
		],
	);
	const r = rows[0];
	if (!r || !r.enabled) return finish(d.id, "skipped", "disabled");
	if (r.enrollment_active === false)
		return finish(d.id, "skipped", "not-active");
	if (r.unsubscribed) return finish(d.id, "skipped", "unsubscribed");
	if (r.suppressed) return finish(d.id, "skipped", "suppressed");
	if (Number(r.recipient_sent) >= MAX_PER_RECIPIENT_PER_DAY) {
		return finish(d.id, "skipped", "recipient-cap");
	}
	const capacity = await academyCapacity(d.organization_id);
	if (!capacity.ok)
		return defer(d.id, capacity.reason, capacity.retryInSeconds);

	try {
		const origin = tenantOrigin(r.slug);
		const attachments = await readStoredAttachments(d.automation_id);
		let certificateUrl = "";
		if (d.enrollment_id) {
			const cert = await pool.query<{ credential_id: string }>(
				`select credential_id from certificates.certificate
				 where enrollment_id = $1 and organization_id = $2 and status = 'valid'`,
				[d.enrollment_id, d.organization_id],
			);
			const credentialId = cert.rows[0]?.credential_id;
			if (credentialId) {
				certificateUrl = `${origin}/certificados/${credentialId}`;
				if (r.attach_certificate) {
					const pdf = await readCertificatePdf(d.organization_id, credentialId);
					if (pdf) {
						attachments.push({ filename: pdf.fileName, content: pdf.pdf });
					}
				}
			}
		}
		const message = buildMessage(
			{
				studentName: r.student,
				courseTitle: r.course,
				academyName: r.academy,
				certificateUrl,
			},
			r,
			`${origin}/baja/${unsubscribeToken(d.organization_id, d.email)}`,
		);
		const messageId = await sendEmail({ to: d.email, ...message, attachments });
		await finish(d.id, "sent", null, messageId);
	} catch (error) {
		const code = errorCode(error);
		log.error({ deliveryId: d.id, code }, "automation email failed");
		if (d.attempts + 1 >= MAX_ATTEMPTS) {
			await pool.query(
				"update automations.message_delivery set attempts = attempts + 1 where id = $1",
				[d.id],
			);
			return finish(d.id, "failed", code);
		}
		// Backoff: 1, 2, 4, 8 minutes.
		await pool.query(
			`update automations.message_delivery
			 set attempts = attempts + 1, last_error = $2,
			     next_attempt_at = now() + make_interval(secs => $3)
			 where id = $1`,
			[d.id, code, 60 * 2 ** d.attempts],
		);
	}
}

/**
 * Sends the due pending deliveries (of one event, or all). A delivery is leased
 * for a few minutes while it is processed so two workers never take the same one.
 * Never throws for a failing email: that is recorded on the delivery.
 */
export async function processDeliveries(eventId?: string): Promise<number> {
	const { rows } = await pool.query<Delivery>(
		`update automations.message_delivery d
		 set next_attempt_at = now() + make_interval(secs => $2)
		 where d.id in (
		   select id from automations.message_delivery
		   where status = 'pending' and next_attempt_at <= now()
		     and ($1::text is null or event_id = $1)
		   order by created_at limit ${BATCH} for update skip locked)
		 returning d.id, d.organization_id, d.automation_id, d.course_id,
		           d.enrollment_id, d.user_id, d.email, d.attempts`,
		[eventId ?? null, LEASE_SECONDS],
	);
	for (const delivery of rows) {
		try {
			await sendOne(delivery);
		} catch (error) {
			// Unexpected failure (database): retry later through the lease expiry.
			log.error({ deliveryId: delivery.id, err: error }, "delivery crashed");
		}
	}
	return rows.length;
}

/**
 * Called by the worker for `enrollment.created` and `course.completed` (after
 * the certificate was issued). Creates one delivery per matching automation of
 * the course's own academy; replaying the event creates nothing new.
 */
export async function runAutomations(event: {
	id: string;
	type: string;
	payload: Record<string, unknown>;
}): Promise<void> {
	const { courseId, userId, enrollmentId } = event.payload;
	if (typeof courseId !== "string" || typeof userId !== "string") return;
	await pool.query(
		`insert into automations.message_delivery
		   (organization_id, automation_id, event_id, course_id, enrollment_id, user_id, email)
		 select c.organization_id, a.id, $1, c.id, $4, u.id, lower(u.email)
		 from catalog.course c
		 join automations.automation a
		   on a.organization_id = c.organization_id and a.enabled and a.trigger = $2
		  and (a.course_id is null or a.course_id = c.id)
		 join auth."user" u on u.id = $3
		 where c.id = $5
		 on conflict (event_id, automation_id) do nothing`,
		[
			event.id,
			event.type,
			userId,
			typeof enrollmentId === "string" ? enrollmentId : null,
			courseId,
		],
	);
	await processDeliveries(event.id);
}

/** Sends the rendered message to the creator, with sample data. Creates no delivery. */
export async function sendTestEmail(input: {
	organizationId: string;
	automationId: string | null;
	to: string;
	subject: string;
	body: string;
	values: Variables;
}): Promise<{ ok: true } | { ok: false; message: string }> {
	const capacity = await academyCapacity(input.organizationId);
	if (!capacity.ok) {
		return {
			ok: false,
			message: "El envío de mensajes está pausado o en el límite.",
		};
	}
	const { rows } = await pool.query<{ slug: string }>(
		"select slug from auth.organization where id = $1",
		[input.organizationId],
	);
	if (!rows[0]) return { ok: false, message: "No encontramos la academia." };
	const owned = input.automationId
		? await pool.query(
				"select 1 from automations.automation where id = $1 and organization_id = $2",
				[input.automationId, input.organizationId],
			)
		: null;
	const attachments =
		input.automationId && owned?.rowCount
			? await readStoredAttachments(input.automationId).catch(() => [])
			: [];
	const message = buildMessage(
		input.values,
		input,
		`${tenantOrigin(rows[0].slug)}/baja/${unsubscribeToken(input.organizationId, input.to)}`,
	);
	try {
		await sendEmail({
			to: input.to,
			...message,
			subject: `[Prueba] ${message.subject}`,
			attachments,
		});
		return { ok: true };
	} catch (error) {
		log.error({ code: errorCode(error) }, "test email failed");
		return { ok: false, message: "No pudimos enviar la prueba." };
	}
}
