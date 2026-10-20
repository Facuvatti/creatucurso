import { createFileRoute } from "@tanstack/react-router";
import {
	handleWebhook,
	paymentsConfig,
} from "../../../areas/payments/payments.ts";
import { fulfillPayment } from "../../../server/fulfillment.server.ts";

// Called by Hyperswitch (not by a browser), so it does not depend on the host.
export const Route = createFileRoute(
	"/api/webhooks/hyperswitch/$organizationId",
)({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				if (!paymentsConfig())
					return new Response("Payments are not configured", { status: 503 });

				const result = await handleWebhook(fulfillPayment, {
					organizationId: params.organizationId,
					rawBody: await request.text(),
					signature: request.headers.get("x-webhook-signature-512"),
				});
				if (result.ok) return new Response("ok", { status: 200 });

				const status =
					result.reason === "bad-signature"
						? 401
						: result.reason === "no-merchant"
							? 404
							: 400;
				return new Response(result.reason, { status });
			},
		},
	},
});
