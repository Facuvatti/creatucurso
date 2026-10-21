import { createFileRoute } from "@tanstack/react-router";
import {
	completeConnection,
	PLATFORM_OWNER,
} from "../../../areas/automations/gmail.ts";
import { auth } from "../../../server/auth.server.ts";

const page = (message: string, status: number) =>
	new Response(
		`<!doctype html><html lang="es"><meta charset="utf-8"><title>Gmail</title><body><p>${message}</p>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8" } },
	);

// Google sends the user back here (the fixed redirect URI of the OAuth client)
// after the consent screen. It runs on the central app host, where the platform
// session lives, and then returns to the academy's panel (or /admin/correo).
export const Route = createFileRoute("/api/gmail/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const params = new URL(request.url).searchParams;
				const state = params.get("state");
				const code = params.get("code");
				if (!state || (!code && !params.get("error"))) {
					return page(
						"No pudimos conectar Gmail: el enlace no es válido. Volvé al panel e intentá de nuevo.",
						400,
					);
				}

				const session = await auth.api.getSession({ headers: request.headers });
				// Only the codes below reach the URL, never tokens or Google's answer.
				const result = await completeConnection({
					state,
					code,
					sessionUser: session
						? { id: session.user.id, email: session.user.email }
						: null,
				});
				if (!result.ok && !result.returnOrigin) {
					return page(
						"El enlace de conexión venció o ya se usó. Volvé al panel y conectá Gmail de nuevo.",
						400,
					);
				}
				const base = `${result.returnOrigin}${
					result.ownerKey === PLATFORM_OWNER
						? "/admin/correo"
						: "/panel/automatizaciones"
				}`;
				return new Response(null, {
					status: 302,
					headers: {
						location: `${base}?gmail=${result.ok ? "connected" : result.reason}`,
					},
				});
			},
		},
	},
});
