// The worker: its own process. Delivers the events that the web app wrote to
// events.outbox in the same transaction as the change they describe.
// Start it with `pnpm worker`.
import { createServer } from "node:http";
import { pool } from "../server/db.server.ts";

const POLL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_BACKOFF_SECONDS = 3600;
const port = Number(process.env.WORKER_PORT ?? 3101);

type OutboxEvent = {
	id: string;
	type: string;
	payload: Record<string, unknown>;
	attempts: number;
};

function log(level: "info" | "error", msg: string, extra: object = {}) {
	console.log(
		JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }),
	);
}

/**
 * What to do with each event. For now it only logs; later phases add
 * automations (Phase 12) and certificates (Phase 11) here. Must be safe to
 * repeat: an event can be delivered again after a crash.
 */
async function handle(event: OutboxEvent): Promise<void> {
	switch (event.type) {
		case "enrollment.created":
		case "course.completed":
		case "enrollment.refunded":
		case "dispute.opened":
		case "dispute.won":
		case "dispute.lost":
			log("info", "event delivered", { id: event.id, type: event.type });
			return;
		default:
			log("info", "event without handler", { id: event.id, type: event.type });
	}
}

let lastPollAt = Date.now();

/** Delivers one batch of due events. Returns how many were taken. */
async function deliverBatch(): Promise<number> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		// SKIP LOCKED lets several workers run without taking the same event.
		const { rows } = await client.query<OutboxEvent>(
			`select id::text, type, payload, attempts from events.outbox
			 where delivered_at is null and available_at <= now()
			 order by id limit $1 for update skip locked`,
			[BATCH_SIZE],
		);
		for (const event of rows) {
			try {
				await handle(event);
				await client.query(
					"update events.outbox set delivered_at = now(), last_error = null where id = $1",
					[event.id],
				);
			} catch (error) {
				// Exponential backoff: 5s, 10s, 20s... up to one hour.
				const wait = Math.min(5 * 2 ** event.attempts, MAX_BACKOFF_SECONDS);
				await client.query(
					`update events.outbox
					 set attempts = attempts + 1, last_error = $2,
					     available_at = now() + make_interval(secs => $3)
					 where id = $1`,
					[event.id, String(error).slice(0, 500), wait],
				);
				log("error", "event failed", {
					id: event.id,
					type: event.type,
					error: String(error),
				});
			}
		}
		await client.query("commit");
		return rows.length;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

let stopping = false;

async function loop() {
	while (!stopping) {
		let taken = 0;
		try {
			taken = await deliverBatch();
			lastPollAt = Date.now();
		} catch (error) {
			log("error", "poll failed", { error: String(error) });
		}
		if (taken < BATCH_SIZE) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
	}
}

// Health: 200 while the loop keeps polling, 503 when it stalled.
const server = createServer((request, response) => {
	if (request.url !== "/health") {
		response.writeHead(404).end();
		return;
	}
	const healthy = Date.now() - lastPollAt < POLL_MS * 15;
	response.writeHead(healthy ? 200 : 503, {
		"content-type": "application/json",
	});
	response.end(JSON.stringify({ ok: healthy }));
});

server.listen(port, () => log("info", "worker started", { port }));

function stop() {
	stopping = true;
	server.close();
	pool.end().finally(() => process.exit(0));
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

await loop();
