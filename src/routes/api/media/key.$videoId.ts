import { createFileRoute } from "@tanstack/react-router";
import { keyFor, readPlaybackToken } from "../../../areas/media/playback.ts";

// GET /api/media/key/<videoId>?t=<token>  -> the 16 raw bytes of the AES-128 key.
export const Route = createFileRoute("/api/media/key/$videoId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const claims = readPlaybackToken(
					new URL(request.url).searchParams.get("t"),
				);
				if (!claims || claims.v !== params.videoId) {
					return new Response("Forbidden", { status: 403 });
				}
				const key = await keyFor(claims);
				if (!key) return new Response("Forbidden", { status: 403 });
				return new Response(new Uint8Array(key), {
					headers: {
						"Content-Type": "application/octet-stream",
						"Cache-Control": "no-store",
					},
				});
			},
		},
	},
});
