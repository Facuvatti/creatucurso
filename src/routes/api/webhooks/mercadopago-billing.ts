import { createFileRoute } from "@tanstack/react-router";
import { handleBillingWebhook } from "../../../areas/billing/subscription.ts";
import {
	describeError,
	readNotification,
} from "../../../areas/payments/mercadopago.ts";

// Subscriptions of the academies to the platform (ADR-0029). Configured in the
// platform's own subscriptions application, signed with MP_PLATFORM_WEBHOOK_SECRET.
export const Route = createFileRoute("/api/webhooks/mercadopago-billing")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const notification = await readNotification(request);
				try {
					const result = await handleBillingWebhook({
						topic: notification.topic,
						dataId: notification.dataId,
						signature: request.headers.get("x-signature"),
						requestId: request.headers.get("x-request-id"),
					});
					if (result.ok) return new Response("ok", { status: 200 });
					const status =
						result.reason === "bad-signature"
							? 401
							: result.reason === "not-configured"
								? 503
								: 400;
					return new Response(result.reason, { status });
				} catch (error) {
					// A non-200 answer makes Mercado Pago retry. Ids and the error code only.
					console.error(
						JSON.stringify({
							level: "error",
							msg: "Mercado Pago billing webhook failed",
							topic: notification.topic,
							dataId: notification.dataId,
							error: describeError(error),
						}),
					);
					return new Response("error", { status: 500 });
				}
			},
		},
	},
});
