// The only way the app sends email (ADR-0027). `sendEmail` picks the sender:
// Amazon SES when AWS credentials and a sender address are configured, otherwise
// the console (development). The EmailSender interface exists so the provider can
// change without touching callers (docs/mails.md section 2).
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type Attachment = { filename: string; content: Buffer };

export type OutgoingEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
	attachments?: Attachment[];
	/** Tenant sending: SES configuration set and event tags. Omit for platform emails. */
	configurationSet?: string;
	tags?: Record<string, string>;
};

export interface EmailSender {
	/** Sends one email and returns the provider message id (null when there is none). */
	send(message: OutgoingEmail): Promise<string | null>;
}

// ------------------------------------------------------------------- SES

function fromAddress(): string | undefined {
	return process.env.SES_FROM_EMAIL || process.env.EMAIL_FROM || undefined;
}

/** Whether emails go through SES. The AWS SDK reads the credentials and region itself. */
export function sesConfigured(): boolean {
	return Boolean(
		process.env.AWS_REGION &&
			process.env.AWS_ACCESS_KEY_ID &&
			process.env.AWS_SECRET_ACCESS_KEY &&
			fromAddress(),
	);
}

let client: SESv2Client | undefined;

/** One shared SES client. A mock endpoint for manual tests: AWS_ENDPOINT_URL_SESV2 (read by the SDK). */
export function sesClient(): SESv2Client {
	client ??= new SESv2Client({});
	return client;
}

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded words (UTF-8, base64), each at most 45 bytes so lines stay short. */
function encodeWords(value: string): string {
	if (ASCII_PRINTABLE.test(value)) return value;
	const words: string[] = [];
	let chunk = "";
	for (const char of value) {
		if (Buffer.byteLength(chunk + char) > 45) {
			words.push(chunk);
			chunk = "";
		}
		chunk += char;
	}
	if (chunk) words.push(chunk);
	return words
		.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`)
		.join("\r\n ");
}

/** Folds base64 at 76 characters per line (RFC 2045). */
function base64Lines(data: Buffer | string): string {
	const base64 = Buffer.from(data).toString("base64");
	return `${base64.match(/.{1,76}/g)?.join("\r\n") ?? ""}\r\n`;
}

const CONTENT_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	zip: "application/zip",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	txt: "text/plain",
};

function noLineBreaks(value: string, what: string): string {
	if (/[\r\n]/.test(value)) throw new Error(`${what} must be a single line.`);
	return value;
}

/** "Name <a@b.c>" with the display name encoded when it is not plain ASCII. */
function addressHeader(address: string): string {
	noLineBreaks(address, "Address");
	const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
	if (!match?.[1]?.trim()) return match?.[2] ?? address.trim();
	const name = match[1].trim();
	const shown = ASCII_PRINTABLE.test(name)
		? `"${name.replace(/(["\\])/g, "\\$1")}"`
		: encodeWords(name);
	return `${shown} <${match[2]}>`;
}

/** Builds a multipart/mixed MIME message: text + html alternative, then attachments. */
export function buildRawMessage(from: string, message: OutgoingEmail): string {
	const id = Math.random().toString(36).slice(2);
	const mixed = `=_mixed_${id}`;
	const alt = `=_alt_${id}`;
	const lines = [
		`From: ${addressHeader(from)}`,
		`To: ${addressHeader(message.to)}`,
		`Subject: ${encodeWords(noLineBreaks(message.subject, "Subject"))}`,
		"MIME-Version: 1.0",
	];
	for (const [name, value] of Object.entries(message.headers ?? {})) {
		if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error("Invalid header name.");
		lines.push(`${name}: ${noLineBreaks(value, "Header value")}`);
	}
	lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, "");

	const part = (type: string, body: string) =>
		`--${alt}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(body)}`;
	let out = `${lines.join("\r\n")}\r\n--${mixed}\r\n`;
	out += `Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n`;
	out += part("text/plain", message.text) + part("text/html", message.html);
	out += `--${alt}--\r\n`;

	for (const a of message.attachments ?? []) {
		const ext = a.filename.split(".").pop()?.toLowerCase() ?? "";
		const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
		const ascii = a.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
		const encoded = encodeURIComponent(a.filename);
		out += `--${mixed}\r\nContent-Type: ${type}; name="${ascii}"\r\n`;
		out += `Content-Transfer-Encoding: base64\r\n`;
		out += `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encoded}\r\n\r\n`;
		out += base64Lines(a.content);
	}
	return `${out}--${mixed}--\r\n`;
}

const sesSender: EmailSender = {
	async send(message) {
		const from = fromAddress();
		if (!from) throw new Error("SES_FROM_EMAIL or EMAIL_FROM is required.");
		// Custom headers (List-Unsubscribe) and attachments need the raw MIME path.
		const raw = Boolean(message.headers || message.attachments?.length);
		const configurationSet =
			message.configurationSet ||
			process.env.SES_PLATFORM_CONFIGURATION_SET ||
			undefined;
		const response = await sesClient().send(
			new SendEmailCommand({
				FromEmailAddress: addressHeader(from),
				Destination: { ToAddresses: [message.to] },
				Content: raw
					? { Raw: { Data: Buffer.from(buildRawMessage(from, message)) } }
					: {
							Simple: {
								Subject: { Data: message.subject, Charset: "UTF-8" },
								Body: {
									Text: { Data: message.text, Charset: "UTF-8" },
									Html: { Data: message.html, Charset: "UTF-8" },
								},
							},
						},
				ConfigurationSetName: configurationSet,
				EmailTags: message.tags
					? Object.entries(message.tags).map(([Name, Value]) => ({
							Name,
							Value,
						}))
					: undefined,
			}),
		);
		return response.MessageId ?? null;
	},
};

// --------------------------------------------------------------- console

/** Development: prints subject and text (links included); never credentials. */
const consoleSender: EmailSender = {
	async send(message) {
		console.log(
			`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
		);
		for (const a of message.attachments ?? []) {
			console.log(
				`[email] Attachment: ${a.filename} (${a.content.length} bytes)`,
			);
		}
		return null;
	},
};

export function sendEmail(message: OutgoingEmail): Promise<string | null> {
	return (sesConfigured() ? sesSender : consoleSender).send(message);
}

/** For values written by users (names) before they go into an HTML email. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
