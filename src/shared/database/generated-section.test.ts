import { describe, expect, it } from "vitest";
import {
	BEGIN_MARKER,
	END_MARKER,
	replaceGeneratedSection,
} from "./generated-section.ts";

const generated = 'create table "user" ("id" text not null primary key);\n';

describe("replaceGeneratedSection", () => {
	it("creates the section when the file is empty", () => {
		const result = replaceGeneratedSection("", generated);

		expect(result).toContain(BEGIN_MARKER);
		expect(result).toContain(END_MARKER);
		expect(result).toContain(generated.trim());
	});

	it("keeps the generated SQL untouched between the markers", () => {
		const result = replaceGeneratedSection("", generated);

		expect(result).toBe(
			`${BEGIN_MARKER}\n${generated.trim()}\n${END_MARKER}\n`,
		);
	});

	it("replaces an existing section and keeps the text around it", () => {
		const before = "-- header\n";
		const after = "CREATE TABLE app_thing (id int);\n";
		const first = replaceGeneratedSection(
			`${before}${after}`,
			'create table "old" (id text);',
		);

		const second = replaceGeneratedSection(first, generated);

		expect(second).toContain('create table "user"');
		expect(second).not.toContain('create table "old"');
		expect(second.startsWith(before)).toBe(true);
		expect(second).toContain(after.trim());
	});

	it("is idempotent", () => {
		const once = replaceGeneratedSection("-- header\n", generated);
		const twice = replaceGeneratedSection(once, generated);

		expect(twice).toBe(once);
	});

	it("refuses a file with only one marker", () => {
		const broken = `-- header\n${BEGIN_MARKER}\nstuff\n`;

		expect(() => replaceGeneratedSection(broken, generated)).toThrow(/marker/i);
	});
});
