import { createFileRoute } from "@tanstack/react-router";
import { handleSnsMessage } from "../../../areas/automations/deliverability.ts";

// SES events through SNS (docs/mails.md). Public; every message is verified
// with Amazon's signature before it is used.
export const Route = createFileRoute("/api/webhooks/ses")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// SNS posts JSON with a text/plain content type.
				const raw = await request.text();
				if (raw.length > 256_000) return new Response("too large", { status: 413 });
				let body: unknown;
				try {
					body = JSON.parse(raw);
				} catch {
					return new Response("bad request", { status: 400 });
				}
				return new Response("ok", { status: await handleSnsMessage(body) });
			},
		},
	},
});
