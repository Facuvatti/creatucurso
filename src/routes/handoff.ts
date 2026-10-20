import { createFileRoute } from "@tanstack/react-router";
import {
	resolveReturnTarget,
	resolveTenant,
} from "../areas/tenancy/tenants.ts";
import { auth } from "../server/auth.server.ts";
import { redirectTo } from "../server/http.server.ts";

// Runs on app.<domain>: turns the central session into a one-time link that
// the creator's site exchanges for its own session cookie (ADR-0001).
export const Route = createFileRoute("/handoff")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const host = await resolveTenant(request.headers.get("host") ?? "");
				if (host.kind !== "platform-app") {
					return new Response("Not found", { status: 404 });
				}

				const returnUrl = new URL(request.url).searchParams.get("return");
				const session = await auth.api.getSession({ headers: request.headers });
				if (!session) {
					const query = returnUrl
						? `?return=${encodeURIComponent(returnUrl)}`
						: "";
					return redirectTo(`/login${query}`);
				}
				if (!returnUrl) return redirectTo("/");

				const target = await resolveReturnTarget(returnUrl);
				if (!target)
					return new Response("Invalid return address", { status: 400 });

				const { token } = await auth.api.generateOneTimeToken({
					headers: request.headers,
				});
				return redirectTo(
					`${target.origin}/auth/handoff?token=${encodeURIComponent(token)}&next=${encodeURIComponent(target.path)}`,
				);
			},
		},
	},
});
