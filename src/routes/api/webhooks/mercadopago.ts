import { createFileRoute } from "@tanstack/react-router";
import {
	describeError,
	readNotification,
} from "../../../areas/payments/mercadopago.ts";
import {
	handlePlatformMercadoPagoWebhook,
	mercadoPagoAvailable,
} from "../../../areas/payments/payments.ts";
import { fulfillPayment } from "../../../server/fulfillment.server.ts";

// The platform webhook (ADR-0023): Mercado Pago calls this one address for
// every academy, so it does not depend on the host.
export const Route = createFileRoute("/api/webhooks/mercadopago")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!mercadoPagoAvailable())
					return new Response("Payments are not configured", { status: 503 });

				const notification = await readNotification(request);
				try {
					const result = await handlePlatformMercadoPagoWebhook(
						fulfillPayment,
						{
							...notification,
							signature: request.headers.get("x-signature"),
							requestId: request.headers.get("x-request-id"),
						},
					);
					if (result.ok) return new Response("ok", { status: 200 });
					const status =
						result.reason === "bad-signature"
							? 401
							: result.reason === "no-merchant"
								? 404
								: result.reason === "disconnected"
									? 503
									: 400;
					return new Response(result.reason, { status });
				} catch (error) {
					// A non-200 answer makes Mercado Pago retry later. Only ids and
					// the error code are logged, never what Mercado Pago answered.
					console.error(
						JSON.stringify({
							level: "error",
							msg: "Mercado Pago webhook failed",
							mpUserId: notification.sellerId,
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
