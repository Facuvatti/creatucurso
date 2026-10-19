import { describe, expect, it } from "vitest";
import { safeLocalPath } from "./safe-path.ts";

describe("safeLocalPath", () => {
	it("keeps same-site paths, including query strings", () => {
		expect(safeLocalPath("/cursos/python?tab=1")).toBe("/cursos/python?tab=1");
	});

	it("falls back to the home page for anything that could leave the site", () => {
		for (const value of [
			"https://evil.example/",
			"//evil.example",
			"/\\evil.example",
			"javascript:alert(1)",
			"cursos",
			"",
			null,
			undefined,
		]) {
			expect(safeLocalPath(value)).toBe("/");
		}
	});
});
