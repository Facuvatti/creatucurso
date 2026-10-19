import { readFileSync } from "node:fs";
import { Client } from "pg";

const url =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

const client = new Client({ connectionString: url });
await client.connect();
try {
	const { rows } = await client.query<{ schema_name: string }>(
		`select schema_name from information_schema.schemata
		 where schema_name not in ('public', 'information_schema') and schema_name not like 'pg\\_%'`,
	);
	for (const { schema_name } of rows) {
		await client.query(`DROP SCHEMA IF EXISTS "${schema_name}" CASCADE`);
	}
	await client.query(readFileSync("database/schema.sql", "utf8"));
	console.log("Development database reset from database/schema.sql.");
} finally {
	await client.end();
}
