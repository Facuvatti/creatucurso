import { readFileSync } from "node:fs";
import { Client } from "pg";
import {
	adminDatabaseUrl,
	e2eDatabaseName,
	e2eDatabaseUrl,
} from "./support.ts";

async function withClient(url: string, run: (client: Client) => Promise<void>) {
	const client = new Client({ connectionString: url });
	await client.connect();
	try {
		await run(client);
	} finally {
		await client.end();
	}
}

export default async function globalSetup() {
	await withClient(adminDatabaseUrl, async (admin) => {
		await admin.query(`DROP DATABASE IF EXISTS ${e2eDatabaseName} WITH (FORCE)`);
		await admin.query(`CREATE DATABASE ${e2eDatabaseName}`);
	});

	await withClient(e2eDatabaseUrl, async (db) => {
		await db.query(readFileSync("database/schema.sql", "utf8"));
		await db.query(
			`insert into auth.organization (id, name, slug, "createdAt", "customDomain", "customDomainVerifiedAt")
			 values
			 ('org_maria', 'Maria Courses', 'maria', now(), 'maria-courses.test', now()),
			 ('org_pending', 'Pending Domain', 'pending', now(), 'pending-site.test', null)`,
		);
	});
}
