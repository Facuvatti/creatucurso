import { describe, expect, it } from "vitest";
import { resolveReturnTarget } from "./resolve-return-target.ts";
import type { TenantDirectory } from "./resolve-tenant.ts";

const maria = { id: "org_1", slug: "maria", name: "Maria Courses" };

const directory: TenantDirectory = {
	findBySlug: async (slug) => (slug === "maria" ? maria : null),
	findByVerifiedCustomDomain: async (domain) =>
		domain === "maria-courses.com" ? maria : null,
};

const deps = {
	directory,
	platformDomain: "example.com",
	allowedProtocol: "https:" as const,
};

describe("resolveReturnTarget", () => {
	it("accepts a creator subdomain and keeps path and query", async () => {
		expect(
			await resolveReturnTarget("https://maria.example.com/cursos/x?a=1", deps),
		).toEqual({ origin: "https://maria.example.com", path: "/cursos/x?a=1" });
	});

	it("accepts a verified custom domain", async () => {
		expect(
			await resolveReturnTarget("https://maria-courses.com/", deps),
		).toEqual({ origin: "https://maria-courses.com", path: "/" });
	});

	it("rejects addresses that are not creator sites", async () => {
		for (const url of [
			"https://evil.example/",
			"https://ghost.example.com/",
			"https://app.example.com/",
			"https://example.com/",
			"not a url",
			"",
		]) {
			expect(await resolveReturnTarget(url, deps)).toBeNull();
		}
	});

	it("rejects other protocols and embedded credentials", async () => {
		for (const url of [
			"http://maria.example.com/",
			"javascript:alert(1)",
			"https://user:pass@maria.example.com/",
		]) {
			expect(await resolveReturnTarget(url, deps)).toBeNull();
		}
	});
});
