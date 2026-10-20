import { createFileRoute } from "@tanstack/react-router";
import { resolveTenant } from "../../areas/tenancy/tenants.ts";
import { auth } from "../../server/auth.server.ts";
import { redirectTo } from "../../server/http.server.ts";
import { safeLocalPath } from "../../shared/safe-path.ts";

// Runs on a creator's site: exchanges the one-time token for a host-only session.
export const Route = createFileRoute("/auth/handoff")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const host = await resolveTenant(request.headers.get("host") ?? "");
				if (host.kind !== "tenant") {
					return new Response("Not found", { status: 404 });
				}

				const params = new URL(request.url).searchParams;
				const token = params.get("token");
				const next = safeLocalPath(params.get("next"));
				if (!token) return redirectTo(next);

				try {
					await auth.api.verifyOneTimeToken({
						body: { token },
						headers: request.headers,
					});
				} catch {
					return redirectTo("/");
				}
				return redirectTo(next);
			},
		},
	},
});
