import { describe, expect, it } from "vitest";
import { validateTenantSlug } from "./tenant-slug.ts";

describe("validateTenantSlug", () => {
	it("accepts lowercase letters, digits and inner hyphens", () => {
		for (const slug of ["maria", "maria-courses", "curso2024", "a1b"]) {
			expect(validateTenantSlug(slug)).toBeNull();
		}
	});

	it("rejects reserved names", () => {
		for (const slug of ["www", "app", "admin", "api", "mail", "cdn"]) {
			expect(validateTenantSlug(slug)).not.toBeNull();
		}
	});

	it("rejects bad shapes", () => {
		for (const slug of [
			"",
			"ab",
			"Maria",
			"-maria",
			"maria-",
			"mar ia",
			"mar_ia",
			"ñandu",
			"a".repeat(64),
		]) {
			expect(validateTenantSlug(slug)).not.toBeNull();
		}
	});
});
