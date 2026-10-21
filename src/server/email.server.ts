// The only way the app sends email: `sendEmail`. For now it prints to the console
// (development); the real sender is added next (ADR-0028).

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

// --------------------------------------------------------------- console

/** Development: prints subject and text (links included); never credentials. */
async function consoleSend(message: OutgoingEmail): Promise<string | null> {
	console.log(
		`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
	);
	for (const a of message.attachments ?? []) {
		console.log(
			`[email] Attachment: ${a.filename} (${a.content.length} bytes)`,
		);
	}
	return null;
}

export function sendEmail(message: OutgoingEmail): Promise<string | null> {
	return consoleSend(message);
}

/** For values written by users (names) before they go into an HTML email. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
