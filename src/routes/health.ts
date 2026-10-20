import { createFileRoute } from "@tanstack/react-router";
import { pool } from "../server/db.server.ts";
import { log } from "../server/log.server.ts";

// Health check for Docker, Caddy and Uptime Kuma. 200 when the database answers,
// 503 otherwise. Public on purpose: it only exposes counters, no data.
export const Route = createFileRoute("/health")({
	server: {
		handlers: {
			GET: async () => {
				try {
					await pool.query("select 1");
				} catch (error) {
					log.error({ err: error }, "health check: database unreachable");
					return Response.json({ ok: false, db: false }, { status: 503 });
				}
				// Business numbers are best effort: a failure here must not fail the check.
				let outboxBacklog: number | null = null;
				try {
					const { rows } = await pool.query<{ n: string }>(
						"select count(*) as n from events.outbox where delivered_at is null",
					);
					outboxBacklog = Number(rows[0].n);
				} catch {}
				return Response.json({ ok: true, db: true, outboxBacklog });
			},
		},
	},
});
