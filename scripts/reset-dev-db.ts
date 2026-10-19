import { readFileSync } from "node:fs";
import { Client } from "pg";

const url =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

const client = new Client({ connectionString: url });
await client.connect();
try {
	await client.query("DROP SCHEMA IF EXISTS auth CASCADE");
	await client.query(readFileSync("database/schema.sql", "utf8"));
	console.log("Development database reset from database/schema.sql.");
} finally {
	await client.end();
}
