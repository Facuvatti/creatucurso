import { createFileRoute } from "@tanstack/react-router";
import {
	handleTusHook,
	hookSecretMatches,
} from "../../../areas/media/media.ts";

// POST /api/media/tus-hook?secret=...  Called by tusd (pre-create, post-finish)
// on the internal network. tusd cannot add custom headers to hook requests, so
// the shared secret MEDIA_HOOK_SECRET travels in the query string; the header
// x-media-hook-secret is accepted too (proxies, manual calls).
export const Route = createFileRoute("/api/media/tus-hook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const given =
					request.headers.get("x-media-hook-secret") ??
					new URL(request.url).searchParams.get("secret");
				if (!hookSecretMatches(given)) {
					return new Response("Forbidden", { status: 403 });
				}
				try {
					return Response.json(await handleTusHook(await request.json()));
				} catch (error) {
					console.error(
						JSON.stringify({
							level: "error",
							msg: "tus hook failed",
							error: String(error),
						}),
					);
					return new Response("error", { status: 500 });
				}
			},
		},
	},
});
