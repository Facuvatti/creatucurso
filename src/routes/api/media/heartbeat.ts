import { createFileRoute } from "@tanstack/react-router";
import { heartbeat, readPlaybackToken } from "../../../areas/media/playback.ts";

// POST /api/media/heartbeat  { token, seconds, bytes }
// Keeps the playback alive (it counts for the stream cap) and records usage.
export const Route = createFileRoute("/api/media/heartbeat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				let body: { token?: unknown; seconds?: unknown; bytes?: unknown } = {};
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: "bad-request" }, { status: 400 });
				}
				const claims = readPlaybackToken(
					typeof body.token === "string" ? body.token : null,
				);
				if (!claims) return Response.json({ error: "denied" }, { status: 403 });

				const number = (value: unknown) =>
					typeof value === "number" && Number.isFinite(value) ? value : 0;
				const result = await heartbeat(claims, {
					seconds: number(body.seconds),
					bytes: number(body.bytes),
				});
				if (result === "ok") return Response.json({ ok: true });
				return Response.json(
					{ error: result },
					{ status: result === "full" ? 429 : 403 },
				);
			},
		},
	},
});
