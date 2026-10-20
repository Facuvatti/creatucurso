import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

/** The one connection pool of the app. Every query goes through it. */
export const pool = new Pool({ connectionString });

/** Runs `run` in one database transaction: commit on success, rollback on error. */
export async function inTransaction<T>(
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await run(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

/**
 * Writes an event to the outbox inside the caller's transaction. The worker
 * delivers it later. The same `dedupeKey` is stored only once.
 */
export async function emitEvent(
	client: PoolClient,
	type: string,
	payload: Record<string, unknown>,
	dedupeKey: string,
): Promise<void> {
	await client.query(
		`insert into events.outbox (type, payload, dedupe_key)
		 values ($1, $2, $3) on conflict (dedupe_key) do nothing`,
		[type, JSON.stringify(payload), dedupeKey],
	);
}
