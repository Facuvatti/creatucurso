// Deliverability (docs/mails.md, ADR-0026): the signed SNS/SES event webhook,
// the global suppression list and the automatic pause of an academy whose
// bounce or complaint rate is too high. Rates are computed from the delivery log.
import { createVerify } from "node:crypto";
import { pool } from "../../server/db.server.ts";
import { log, reportError } from "../../server/log.server.ts";

// Evaluated over the last 7 days, and only with at least this many sent emails.
const WINDOW = "7 days";
const MIN_SAMPLE = 100;

function threshold(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

type SnsMessage = Record<string, string>;

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certificates = new Map<string, string>();

function amazonUrl(value: string | undefined): URL | null {
	try {
		const url = new URL(value ?? "");
		return url.protocol === "https:" && CERT_HOST.test(url.hostname)
			? url
			: null;
	} catch {
		return null;
	}
}

const SIGNED_FIELDS: Record<string, string[]> = {
	Notification: [
		"Message",
		"MessageId",
		"Subject",
		"Timestamp",
		"TopicArn",
		"Type",
	],
	SubscriptionConfirmation: [
		"Message",
		"MessageId",
		"SubscribeURL",
		"Timestamp",
		"Token",
		"TopicArn",
		"Type",
	],
	UnsubscribeConfirmation: [
		"Message",
		"MessageId",
		"SubscribeURL",
		"Timestamp",
		"Token",
		"TopicArn",
		"Type",
	],
};

/** Verifies the signature of an SNS message with Amazon's certificate. */
async function verifySignature(message: SnsMessage): Promise<boolean> {
	const fields = SIGNED_FIELDS[message.Type ?? ""];
	const certUrl = amazonUrl(message.SigningCertURL);
	if (!fields || !certUrl || !message.Signature) return false;
	if (!["1", "2"].includes(message.SignatureVersion ?? "")) return false;
	const expectedTopic = process.env.SES_SNS_TOPIC_ARN;
	if (expectedTopic && message.TopicArn !== expectedTopic) return false;

	let pem = certificates.get(certUrl.href);
	if (!pem) {
		const response = await fetch(certUrl);
		if (!response.ok) return false;
		pem = await response.text();
		certificates.set(certUrl.href, pem);
	}
	const signed = fields
		.filter((key) => message[key] !== undefined)
		.map((key) => `${key}\n${message[key]}\n`)
		.join("");
	const verifier = createVerify(
		message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1",
	);
	verifier.update(signed, "utf8");
	return verifier.verify(pem, message.Signature, "base64");
}

/** Pauses the academy when its recent bounce or complaint rate is over the limit. */
export async function evaluateAcademy(organizationId: string): Promise<void> {
	const { rows } = await pool.query<{
		sent: string;
		bounces: string;
		complaints: string;
	}>(
		`select count(*) as sent,
		        count(*) filter (where provider_event = 'bounce') as bounces,
		        count(*) filter (where provider_event = 'complaint') as complaints
		 from automations.message_delivery
		 where organization_id = $1 and status = 'sent' and sent_at > now() - interval '${WINDOW}'`,
		[organizationId],
	);
	const sent = Number(rows[0]?.sent);
	if (sent < MIN_SAMPLE) return;
	const bounceRate = Number(rows[0]?.bounces) / sent;
	const complaintRate = Number(rows[0]?.complaints) / sent;
	const reason =
		bounceRate > threshold("EMAIL_MAX_BOUNCE_RATE", 0.05)
			? "bounce-rate"
			: complaintRate > threshold("EMAIL_MAX_COMPLAINT_RATE", 0.001)
				? "complaint-rate"
				: null;
	if (!reason) return;
	const paused = await pool.query(
		`insert into automations.sending (organization_id, status, paused_at, paused_reason)
		 values ($1, 'paused', now(), $2)
		 on conflict (organization_id) do update
		   set status = 'paused', paused_at = now(), paused_reason = $2
		 where automations.sending.status = 'active'`,
		[organizationId, reason],
	);
	if (paused.rowCount) {
		// The platform admin resumes it by hand (ADR-0026).
		reportError(
			"academy email sending paused",
			new Error(`${reason} for ${organizationId}`),
		);
	}
}

async function suppress(email: string, reason: "bounce" | "complaint") {
	await pool.query(
		"insert into automations.suppression (email, reason) values ($1, $2) on conflict do nothing",
		[email.toLowerCase(), reason],
	);
}

/**
 * Handles one SNS message posted by SES (verified first). Idempotent: events can
 * arrive duplicated or out of order. Returns the HTTP status to answer.
 */
export async function handleSnsMessage(raw: unknown): Promise<number> {
	if (typeof raw !== "object" || raw === null) return 400;
	const message = raw as SnsMessage;
	if (!(await verifySignature(message).catch(() => false))) return 401;

	if (message.Type === "SubscriptionConfirmation") {
		const url = amazonUrl(message.SubscribeURL);
		if (!url) return 400;
		await fetch(url);
		return 200;
	}
	if (message.Type !== "Notification") return 200;

	let event: {
		eventType?: string;
		mail?: { messageId?: string };
		bounce?: {
			bounceType?: string;
			bouncedRecipients?: { emailAddress: string }[];
		};
		complaint?: { complainedRecipients?: { emailAddress: string }[] };
	};
	try {
		event = JSON.parse(message.Message ?? "");
	} catch {
		return 400;
	}
	const messageId = event.mail?.messageId;
	let providerEvent: string | null = null;

	if (
		event.eventType === "Bounce" &&
		event.bounce?.bounceType === "Permanent"
	) {
		providerEvent = "bounce";
		for (const r of event.bounce.bouncedRecipients ?? []) {
			await suppress(r.emailAddress, "bounce");
		}
	} else if (event.eventType === "Complaint") {
		providerEvent = "complaint";
		for (const r of event.complaint?.complainedRecipients ?? []) {
			await suppress(r.emailAddress, "complaint");
		}
	} else if (event.eventType === "Delivery") {
		providerEvent = "delivered";
	} else if (event.eventType === "Reject") {
		reportError("ses rejected an email", new Error(messageId ?? "unknown"));
	}
	if (!messageId || !providerEvent) return 200;

	// Never downgrade a bounce or complaint to a late "delivered".
	const { rows } = await pool.query<{ organization_id: string }>(
		`update automations.message_delivery
		 set provider_event = $2
		 where provider_message_id = $1
		   and (provider_event is null or $2 <> 'delivered')
		 returning organization_id`,
		[messageId, providerEvent],
	);
	if (rows[0]) {
		await evaluateAcademy(rows[0].organization_id);
		log.info({ providerEvent }, "email event recorded");
	}
	return 200;
}
