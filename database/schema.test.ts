import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createTempDatabase,
	type TempDatabase,
} from "../src/shared/database/temp-database.ts";

const adminUrl =
	process.env.DATABASE_URL ??
	"postgres://creatucurso:creatucurso@localhost:5432/creatucurso";

describe("database/schema.sql", () => {
	let temp: TempDatabase;
	let client: Client;

	beforeAll(async () => {
		temp = await createTempDatabase(adminUrl);
		client = new Client({ connectionString: temp.url });
		await client.connect();
		await client.query(readFileSync("database/schema.sql", "utf8"));
	});

	afterAll(async () => {
		await client?.end();
		await temp?.drop();
	});

	const tablesIn = async (schema: string) => {
		const { rows } = await client.query<{ table_name: string }>(
			"select table_name from information_schema.tables where table_schema = $1",
			[schema],
		);
		return rows.map((row) => row.table_name).sort();
	};

	it("creates the better-auth tables in the auth schema", async () => {
		expect(await tablesIn("auth")).toEqual(
			[
				"account",
				"invitation",
				"member",
				"organization",
				"session",
				"twoFactor",
				"user",
				"verification",
			].sort(),
		);
	});

	it("adds the tenant columns to the organization table", async () => {
		const { rows } = await client.query<{ column_name: string }>(
			"select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'organization'",
		);
		const columns = rows.map((row) => row.column_name);

		expect(columns).toEqual(
			expect.arrayContaining([
				"slug",
				"customDomain",
				"customDomainVerifiedAt",
				"hyperswitchMerchantId",
				"hyperswitchProfileId",
				"videoPlan",
				"drmLibraryId",
			]),
		);
	});

	it("keeps the custom domain unique", async () => {
		const { rows } = await client.query<{ is_unique: boolean }>(
			`select exists (
				select 1 from pg_index i
				join pg_class t on t.oid = i.indrelid
				join pg_namespace n on n.oid = t.relnamespace
				join pg_attribute a on a.attrelid = t.oid and a.attnum = any(i.indkey)
				where n.nspname = 'auth' and t.relname = 'organization'
				and a."attname" = 'customDomain' and i.indisunique
			) as is_unique`,
		);

		expect(rows[0]?.is_unique).toBe(true);
	});

	it("creates nothing outside the auth schema", async () => {
		expect(await tablesIn("public")).toEqual([]);
	});
});
