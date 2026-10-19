import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createTempDatabase } from "./temp-database.ts";

const defaultAdminUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

export type SchemaDatabase = {
	pool: Pool;
	close: () => Promise<void>;
};

/** A throwaway database with database/schema.sql applied, for integration tests. */
export async function createSchemaDatabase(
	adminUrl: string = defaultAdminUrl,
): Promise<SchemaDatabase> {
	const temp = await createTempDatabase(adminUrl);
	const pool = new Pool({ connectionString: temp.url });
	await pool.query(readFileSync("database/schema.sql", "utf8"));

	return {
		pool,
		close: async () => {
			await pool.end();
			await temp.drop();
		},
	};
}
