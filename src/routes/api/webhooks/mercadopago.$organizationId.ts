// LEGACY: remove after migration. Notifications of academies that still use
// credentials pasted by hand, verified with that academy's own secret. New
// connections use /api/webhooks/mercadopago (ADR-0023).
import { createFileRoute } from "@tanstack/react-router";
import {
	describeError,
	readNotification,
} from "../../../areas/payments/mercadopago.ts";
import { handleMercadoPagoWebhook } from "../../../areas/payments/payments.ts";
import { fulfillPayment } from "../../../server/fulfillment.server.ts";

// Called by Mercado Pago (not by a browser), so it does not depend on the host.
export const Route = createFileRoute(
	"/api/webhooks/mercadopago/$organizationId",
)({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				if (!process.env.SECRETS_ENCRYPTION_KEY)
					return new Response("Payments are not configured", { status: 503 });

				const { topic, dataId } = await readNotification(request);
				try {
					const result = await handleMercadoPagoWebhook(fulfillPayment, {
						organizationId: params.organizationId,
						topic,
						dataId,
						signature: request.headers.get("x-signature"),
						requestId: request.headers.get("x-request-id"),
					});
					if (result.ok) return new Response("ok", { status: 200 });
					const status =
						result.reason === "bad-signature"
							? 401
							: result.reason === "no-merchant"
								? 404
								: 400;
					return new Response(result.reason, { status });
				} catch (error) {
					// A non-200 answer makes Mercado Pago retry later.
					console.error(
						JSON.stringify({
							level: "error",
							msg: "Mercado Pago webhook failed",
							organizationId: params.organizationId,
							topic,
							dataId,
							error: describeError(error),
						}),
					);
					return new Response("error", { status: 500 });
				}
			},
		},
	},
});
