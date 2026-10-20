/**
 * The only way the app sends email (ADR-0016). With RESEND_API_KEY set it posts
 * to Resend; without it the message is printed to the console (development).
 */
export async function sendEmail(message: {
	to: string;
	subject: string;
	text: string;
	html: string;
	headers?: Record<string, string>;
	attachments?: { filename: string; content: Buffer }[];
}): Promise<string | null> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		console.log(
			`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
		);
		for (const a of message.attachments ?? []) {
			console.log(`[email] Attachment: ${a.filename} (${a.content.length} bytes)`);
		}
		return null;
	}

	const from = process.env.EMAIL_FROM;
	if (!from)
		throw new Error("EMAIL_FROM is required when RESEND_API_KEY is set.");

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html,
			headers: message.headers,
			attachments: message.attachments?.map((a) => ({
				filename: a.filename,
				content: a.content.toString("base64"),
			})),
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Resend rejected the email (${response.status}): ${await response.text()}`,
		);
	}
	const body = (await response.json().catch(() => null)) as {
		id?: string;
	} | null;
	return body?.id ?? null;
}

/** For values written by users (names) before they go into an HTML email. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
