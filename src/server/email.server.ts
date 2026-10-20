/**
 * The only way the app sends email (ADR-0016). With RESEND_API_KEY set it posts
 * to Resend; without it the message is printed to the console (development).
 */
export async function sendEmail(message: {
	to: string;
	subject: string;
	text: string;
	html: string;
}): Promise<void> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		console.log(
			`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
		);
		return;
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
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Resend rejected the email (${response.status}): ${await response.text()}`,
		);
	}
}

/** For values written by users (names) before they go into an HTML email. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
