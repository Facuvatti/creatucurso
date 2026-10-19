import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createSchemaDatabase,
	type SchemaDatabase,
} from "../../../shared/database/schema-database.ts";
import { createPgMembershipReader } from "./pg-membership-reader.ts";

describe("createPgMembershipReader", () => {
	let db: SchemaDatabase;

	beforeAll(async () => {
		db = await createSchemaDatabase();
		await db.pool.query(`
			insert into auth."user" (id, name, email, "emailVerified") values
			 ('u1', 'Ana', 'ana@example.com', true),
			 ('u2', 'Beto', 'beto@example.com', true);
			insert into auth.organization (id, name, slug, "createdAt") values
			 ('o1', 'Zeta Academy', 'zeta', now()),
			 ('o2', 'Alfa Academy', 'alfa', now());
			insert into auth.member (id, "organizationId", "userId", role, "createdAt") values
			 ('m1', 'o1', 'u1', 'owner', now()),
			 ('m2', 'o2', 'u1', 'student', now()),
			 ('m3', 'o1', 'u2', 'tutor,student', now());
		`);
	});

	afterAll(async () => {
		await db?.close();
	});

	it("returns the roles of a member", async () => {
		const reader = createPgMembershipReader(db.pool);

		expect(await reader.findRoles("o1", "u1")).toEqual(["owner"]);
	});

	it("splits several roles stored in one value", async () => {
		const reader = createPgMembershipReader(db.pool);

		expect(await reader.findRoles("o1", "u2")).toEqual(["tutor", "student"]);
	});

	it("returns no roles for someone who is not a member", async () => {
		const reader = createPgMembershipReader(db.pool);

		expect(await reader.findRoles("o2", "u2")).toEqual([]);
	});

	it("lists a person's memberships ordered by academy name", async () => {
		const reader = createPgMembershipReader(db.pool);

		expect(await reader.listForUser("u1")).toEqual([
			{
				organizationId: "o2",
				slug: "alfa",
				name: "Alfa Academy",
				roles: ["student"],
			},
			{
				organizationId: "o1",
				slug: "zeta",
				name: "Zeta Academy",
				roles: ["owner"],
			},
		]);
	});
});
