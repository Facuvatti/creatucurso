import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createSchemaDatabase,
	type SchemaDatabase,
} from "../../../shared/database/schema-database.ts";
import { createPgTenantDirectory } from "./pg-tenant-directory.ts";

describe("createPgTenantDirectory", () => {
	let db: SchemaDatabase;

	beforeAll(async () => {
		db = await createSchemaDatabase();
		await db.pool.query(
			`insert into auth.organization (id, name, slug, "createdAt", "customDomain", "customDomainVerifiedAt")
			 values
			 ('org_1', 'Maria Courses', 'maria', now(), 'maria-courses.com', now()),
			 ('org_2', 'Pending Domain', 'pending', now(), 'pending-site.com', null),
			 ('org_3', 'No Domain', 'nodomain', now(), null, null)`,
		);
	});

	afterAll(async () => {
		await db?.close();
	});

	it("finds a tenant by slug", async () => {
		const directory = createPgTenantDirectory(db.pool);

		expect(await directory.findBySlug("maria")).toEqual({
			id: "org_1",
			slug: "maria",
			name: "Maria Courses",
		});
	});

	it("returns null for an unknown slug", async () => {
		const directory = createPgTenantDirectory(db.pool);

		expect(await directory.findBySlug("ghost")).toBeNull();
	});

	it("finds a tenant by verified custom domain", async () => {
		const directory = createPgTenantDirectory(db.pool);

		expect(
			await directory.findByVerifiedCustomDomain("maria-courses.com"),
		).toEqual({ id: "org_1", slug: "maria", name: "Maria Courses" });
	});

	it("ignores custom domains that are not verified", async () => {
		const directory = createPgTenantDirectory(db.pool);

		expect(
			await directory.findByVerifiedCustomDomain("pending-site.com"),
		).toBeNull();
	});

	it("treats input as data, not as SQL", async () => {
		const directory = createPgTenantDirectory(db.pool);

		expect(await directory.findBySlug("maria' or '1'='1")).toBeNull();
		expect(
			await directory.findByVerifiedCustomDomain(
				"x' or customDomain is not null --",
			),
		).toBeNull();
	});
});
