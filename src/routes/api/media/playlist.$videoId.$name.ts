import { createFileRoute } from "@tanstack/react-router";
import {
	readPlaybackToken,
	renderPlaylist,
} from "../../../areas/media/playback.ts";

// GET /api/media/playlist/<videoId>/<master|480p|720p>?t=<token>
// The HLS playlists of one playback: key from the app, signed segment URLs.
export const Route = createFileRoute("/api/media/playlist/$videoId/$name")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const token = new URL(request.url).searchParams.get("t");
				const claims = readPlaybackToken(token);
				if (!token || !claims || claims.v !== params.videoId) {
					return new Response("Forbidden", { status: 403 });
				}
				const playlist = await renderPlaylist(claims, token, params.name);
				if (playlist === null)
					return new Response("Not found", { status: 404 });
				return new Response(playlist, {
					headers: {
						"Content-Type": "application/vnd.apple.mpegurl",
						"Cache-Control": "no-store",
					},
				});
			},
		},
	},
});
