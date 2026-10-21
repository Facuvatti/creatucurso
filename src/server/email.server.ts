// The only way the app sends email (ADR-0028). Academy emails go out from the
// academy's own Gmail (`sendTenantEmail`); platform emails (verification, password
// reset) from the platform Gmail (`sendPlatformEmail`), falling back to the console.
import { PLATFORM_OWNER, sendViaGmail } from "../areas/automations/gmail.ts";
import { reportError } from "./log.server.ts";

export type Attachment = { filename: string; content: Buffer };

export type OutgoingEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
	attachments?: Attachment[];
};

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

// ----------------------------------------------------------------- senders

/** Display name safe for a header: one line, no quotes or angle brackets. */
function displayName(name: string): string {
	return (
		name
			.replace(/[\r\n]+/g, " ")
			.replace(/["<>]/g, "")
			.trim() || "Creatucurso"
	);
}

/**
 * Sends from the academy's connected Gmail, with Reply-To the same address.
 * Returns the Gmail message id. Throws GmailNotConnected, GmailRetry or GmailError.
 */
export function sendTenantEmail(
	message: OutgoingEmail,
	tenant: { id: string; name: string },
): Promise<string> {
	return sendViaGmail(tenant.id, (sender) =>
		Buffer.from(
			buildRawMessage(`${displayName(tenant.name)} <${sender}>`, {
				...message,
				headers: { "Reply-To": sender, ...message.headers },
			}),
		),
	);
}

/** Development fallback: prints subject and text (links included). Production prints the subject only. */
function consoleSend(message: OutgoingEmail): void {
	if (process.env.NODE_ENV === "production") {
		console.log(`[email] Not sent, no platform Gmail: ${message.subject}`);
		return;
	}
	console.log(
		`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
	);
}

let reportedPlatformFailure = false;

/**
 * Platform emails (verification, password reset, alerts). Uses the platform Gmail
 * connection; when it is missing or fails the message goes to the console and the
 * failure is reported once. Never throws, so sign-up and reset never block.
 */
export async function sendPlatformEmail(message: OutgoingEmail): Promise<void> {
	try {
		await sendViaGmail(PLATFORM_OWNER, (sender) =>
			Buffer.from(
				buildRawMessage(`Creatucurso <${sender}>`, {
					...message,
					headers: { "Reply-To": sender, ...message.headers },
				}),
			),
		);
		reportedPlatformFailure = false;
	} catch (error) {
		if (!reportedPlatformFailure) {
			reportedPlatformFailure = true;
			reportError("Sending a platform email through Gmail failed", error);
		}
		consoleSend(message);
	}
}

/** For values written by users (names) before they go into an HTML email. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
