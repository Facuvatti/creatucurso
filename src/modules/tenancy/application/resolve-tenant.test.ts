import { describe, expect, it } from "vitest";
import type { Tenant } from "../domain/tenant.ts";
import { resolveTenant, type TenantDirectory } from "./resolve-tenant.ts";

const maria: Tenant = { id: "org_1", slug: "maria", name: "Maria Courses" };
const config = { platformDomain: "example.com" };

function fakeDirectory() {
	const calls: string[] = [];
	const directory: TenantDirectory = {
		async findBySlug(slug) {
			calls.push(`slug:${slug}`);
			return slug === "maria" ? maria : null;
		},
		async findByVerifiedCustomDomain(domain) {
			calls.push(`domain:${domain}`);
			return domain === "maria-courses.com" ? maria : null;
		},
	};
	return { directory, calls };
}

describe("resolveTenant", () => {
	it("returns the landing and the central app without asking the directory", async () => {
		const { directory, calls } = fakeDirectory();

		expect(await resolveTenant("example.com", { directory, config })).toEqual({
			kind: "landing",
		});
		expect(
			await resolveTenant("app.example.com", { directory, config }),
		).toEqual({ kind: "platform-app" });
		expect(calls).toEqual([]);
	});

	it("resolves a creator by subdomain", async () => {
		const { directory, calls } = fakeDirectory();

		const result = await resolveTenant("MARIA.example.com:3000", {
			directory,
			config,
		});

		expect(result).toEqual({ kind: "tenant", tenant: maria });
		expect(calls).toEqual(["slug:maria"]);
	});

	it("resolves a creator by verified custom domain", async () => {
		const { directory, calls } = fakeDirectory();

		const result = await resolveTenant("maria-courses.com", {
			directory,
			config,
		});

		expect(result).toEqual({ kind: "tenant", tenant: maria });
		expect(calls).toEqual(["domain:maria-courses.com"]);
	});

	it("returns unknown for a subdomain nobody owns", async () => {
		const { directory } = fakeDirectory();

		expect(
			await resolveTenant("nobody.example.com", { directory, config }),
		).toEqual({ kind: "unknown" });
	});

	it("returns unknown for a custom domain that is not verified or not registered", async () => {
		const { directory } = fakeDirectory();

		expect(
			await resolveTenant("other-site.com", { directory, config }),
		).toEqual({ kind: "unknown" });
	});

	it("does not query the directory for invalid hosts", async () => {
		const { directory, calls } = fakeDirectory();

		expect(
			await resolveTenant("a.b.example.com", { directory, config }),
		).toEqual({ kind: "unknown" });
		expect(await resolveTenant("", { directory, config })).toEqual({
			kind: "unknown",
		});
		expect(calls).toEqual([]);
	});
});
