import { createFileRoute } from "@tanstack/react-router";
import {
	handleMercadoPagoWebhook,
	mercadoPagoAvailable,
} from "../../../areas/payments/payments.ts";
import { fulfillPayment } from "../../../server/fulfillment.server.ts";

// Called by Mercado Pago (not by a browser), so it does not depend on the host.
export const Route = createFileRoute(
	"/api/webhooks/mercadopago/$organizationId",
)({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				if (!mercadoPagoAvailable())
					return new Response("Payments are not configured", { status: 503 });

				const url = new URL(request.url);
				let body: { type?: unknown; data?: { id?: unknown } } = {};
				try {
					body = await request.json();
				} catch {
					// Some notifications carry everything in the query string.
				}
				const bodyId = body.data?.id;
				// The signature is computed over the data.id of the query string.
				const dataId =
					url.searchParams.get("data.id") ??
					(typeof bodyId === "string" || typeof bodyId === "number"
						? String(bodyId)
						: null);
				const topic =
					(typeof body.type === "string" ? body.type : null) ??
					url.searchParams.get("type") ??
					url.searchParams.get("topic");

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
							error: String(error),
						}),
					);
					return new Response("error", { status: 500 });
				}
			},
		},
	},
});
