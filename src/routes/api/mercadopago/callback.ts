import { createFileRoute } from "@tanstack/react-router";
import { completeConnection } from "../../../areas/payments/mercadopago-connection.ts";
import { auth } from "../../../server/auth.server.ts";

const page = (message: string, status: number) =>
	new Response(
		`<!doctype html><html lang="es"><meta charset="utf-8"><title>Mercado Pago</title><body><p>${message}</p>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8" } },
	);

// Mercado Pago sends the owner back here (the fixed redirect_uri of the
// application) after authorizing. It runs on the central app host, where the
// platform session lives, and then returns to the academy's panel.
export const Route = createFileRoute("/api/mercadopago/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const params = new URL(request.url).searchParams;
				const state = params.get("state");
				const code = params.get("code");
				if (!state || !code) {
					return page(
						"No pudimos conectar Mercado Pago: no autorizaste la conexión o el enlace no es válido. Volvé al panel de tu academia e intentá de nuevo.",
						400,
					);
				}

				const session = await auth.api.getSession({ headers: request.headers });
				// Only the codes below reach the URL, never tokens or Mercado Pago's answer.
				const result = await completeConnection({
					state,
					code,
					sessionUserId: session?.user.id ?? null,
				});
				if (!result.ok) {
					if (!result.returnOrigin) {
						return page(
							"El enlace de conexión venció o ya se usó. Volvé al panel de tu academia y conectá Mercado Pago de nuevo.",
							400,
						);
					}
					return redirect(
						`${result.returnOrigin}/panel/pagos?mp=${result.reason}`,
					);
				}
				return redirect(`${result.returnOrigin}/panel/pagos?mp=connected`);
			},
		},
	},
});

function redirect(location: string) {
	return new Response(null, { status: 302, headers: { location } });
}
