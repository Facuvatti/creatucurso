import { createFileRoute } from "@tanstack/react-router";
import {
	readUnsubscribeToken,
	recordUnsubscribe,
} from "../areas/automations/delivery.ts";
import { readRequestContext } from "../server/request.server.ts";

function page(title: string, body: string, status = 200): Response {
	return new Response(
		`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>${title}</h1>${body}</body></html>`,
		{
			status,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			},
		},
	);
}

/** The token must be valid and belong to the academy of this host. */
async function readToken(token: string) {
	const context = await readRequestContext();
	if (context.host.kind !== "tenant") return null;
	const parsed = readUnsubscribeToken(token);
	return parsed && parsed.organizationId === context.host.tenant.id
		? { ...parsed, academy: context.host.tenant.name }
		: null;
}

const INVALID = () => page("Enlace inválido", "<p>Este enlace no es válido.</p>", 404);

// GET shows a confirmation button (mail scanners that open links do not unsubscribe
// anyone); POST records the unsubscribe, also used by the one-click header.
export const Route = createFileRoute("/baja/$token")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const found = await readToken(params.token);
				if (!found) return INVALID();
				return page(
					"Dejar de recibir mensajes",
					`<p>¿Querés dejar de recibir mensajes automáticos de esta academia?</p><form method="post"><button type="submit" style="padding:.6rem 1rem">Confirmar baja</button></form>`,
				);
			},
			POST: async ({ params }) => {
				const found = await readToken(params.token);
				if (!found) return INVALID();
				await recordUnsubscribe(found.organizationId, found.email);
				return page(
					"Listo",
					"<p>No vas a recibir más mensajes automáticos de esta academia.</p>",
				);
			},
		},
	},
});
