import { describe, expect, it } from "vitest";
import type { TenantDirectory } from "../application/resolve-tenant.ts";
import type { Tenant } from "../domain/tenant.ts";
import { createCachedTenantDirectory } from "./cached-tenant-directory.ts";

const maria: Tenant = { id: "org_1", slug: "maria", name: "Maria Courses" };

function setup(options: { maxEntries?: number } = {}) {
	let time = 0;
	const calls: string[] = [];
	let fail = false;
	const inner: TenantDirectory = {
		async findBySlug(slug) {
			calls.push(`slug:${slug}`);
			if (fail) throw new Error("database down");
			return slug === "maria" ? maria : null;
		},
		async findByVerifiedCustomDomain(domain) {
			calls.push(`domain:${domain}`);
			return domain === "maria-courses.com" ? maria : null;
		},
	};
	const directory = createCachedTenantDirectory(inner, {
		ttlMs: 60_000,
		missTtlMs: 5_000,
		maxEntries: options.maxEntries ?? 100,
		now: () => time,
	});
	return {
		directory,
		calls,
		advance: (ms: number) => {
			time += ms;
		},
		failNext: (value: boolean) => {
			fail = value;
		},
	};
}

describe("createCachedTenantDirectory", () => {
	it("serves a repeated lookup from memory", async () => {
		const { directory, calls } = setup();

		await directory.findBySlug("maria");
		const second = await directory.findBySlug("maria");

		expect(second).toEqual(maria);
		expect(calls).toEqual(["slug:maria"]);
	});

	it("asks again once the entry has expired", async () => {
		const { directory, calls, advance } = setup();

		await directory.findBySlug("maria");
		advance(60_001);
		await directory.findBySlug("maria");

		expect(calls).toEqual(["slug:maria", "slug:maria"]);
	});

	it("remembers unknown hosts for a shorter time", async () => {
		const { directory, calls, advance } = setup();

		await directory.findBySlug("ghost");
		advance(4_000);
		await directory.findBySlug("ghost");
		expect(calls).toEqual(["slug:ghost"]);

		advance(1_001);
		await directory.findBySlug("ghost");
		expect(calls).toEqual(["slug:ghost", "slug:ghost"]);
	});

	it("keeps slug and custom domain lookups apart", async () => {
		const { directory, calls } = setup();

		await directory.findBySlug("maria");
		await directory.findByVerifiedCustomDomain("maria-courses.com");

		expect(calls).toEqual(["slug:maria", "domain:maria-courses.com"]);
	});

	it("evicts the least recently used entry when full", async () => {
		const { directory, calls } = setup({ maxEntries: 2 });

		await directory.findBySlug("a");
		await directory.findBySlug("b");
		await directory.findBySlug("a");
		await directory.findBySlug("c");
		calls.length = 0;

		await directory.findBySlug("a");
		await directory.findBySlug("b");

		expect(calls).toEqual(["slug:b"]);
	});

	it("shares one lookup between concurrent requests", async () => {
		const { directory, calls } = setup();

		const results = await Promise.all([
			directory.findBySlug("maria"),
			directory.findBySlug("maria"),
			directory.findBySlug("maria"),
		]);

		expect(results).toEqual([maria, maria, maria]);
		expect(calls).toEqual(["slug:maria"]);
	});

	it("does not remember failures", async () => {
		const { directory, calls, failNext } = setup();

		failNext(true);
		await expect(directory.findBySlug("maria")).rejects.toThrow(
			"database down",
		);
		failNext(false);

		expect(await directory.findBySlug("maria")).toEqual(maria);
		expect(calls).toEqual(["slug:maria", "slug:maria"]);
	});

	it("forgets everything on clear", async () => {
		const { directory, calls } = setup();

		await directory.findBySlug("maria");
		directory.clear();
		await directory.findBySlug("maria");

		expect(calls).toEqual(["slug:maria", "slug:maria"]);
	});
});
