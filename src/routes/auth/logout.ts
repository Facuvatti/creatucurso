import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../server/auth.server.ts";
import { redirectTo } from "../../server/http.server.ts";

export const Route = createFileRoute("/auth/logout")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				await auth.api.signOut({ headers: request.headers });
				return redirectTo("/", 303);
			},
		},
	},
});
