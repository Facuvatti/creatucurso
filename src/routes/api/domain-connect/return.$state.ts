import { createFileRoute } from "@tanstack/react-router";
import { finishDomainConnect } from "../../../areas/tenancy/domain-connect.ts";

const page = (message: string, status: number) =>
	new Response(
		`<!doctype html><html lang="es"><meta charset="utf-8"><title>Dominio propio</title><body><p>${message}</p>`,
		{ status, headers: { "content-type": "text/html; charset=utf-8" } },
	);

// The DNS provider sends the owner back here (redirect_uri of the Domain
// Connect apply call, on the app host listed in syncRedirectDomain). The state
// is in the path because some providers do not return the `state` parameter.
// The state is signed and single use; what follows is only the idempotent CNAME
// check of that academy, so no session is required on this host.
export const Route = createFileRoute("/api/domain-connect/return/$state")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const error = new URL(request.url).searchParams.get("error");
				const result = await finishDomainConnect(params.state, error);
				if (!result) {
					return page(
						"El enlace de conexión venció o ya se usó. Volvé al panel de tu academia, en Dominio propio.",
						400,
					);
				}
				return new Response(null, {
					status: 302,
					headers: {
						location: `${result.returnOrigin}/panel/dominio?conexion=${result.outcome}`,
					},
				});
			},
		},
	},
});
