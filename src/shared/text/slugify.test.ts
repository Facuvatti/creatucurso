import { describe, expect, it } from "vitest";
import { MAX_SLUG_LENGTH, slugify } from "./slugify.ts";

describe("slugify", () => {
	it("lowercases and joins words with hyphens", () => {
		expect(slugify("Introducción al Desarrollo Web")).toBe(
			"introduccion-al-desarrollo-web",
		);
	});

	it("removes accents and keeps the base letter", () => {
		expect(slugify("Año Nuevo – Ñandú Güemes")).toBe("ano-nuevo-nandu-guemes");
	});

	it("drops punctuation and symbols", () => {
		expect(slugify("¿Qué es HTML? Guía #1")).toBe("que-es-html-guia-1");
	});

	it("collapses repeated separators and trims them", () => {
		expect(slugify("  --Hola   mundo--  ")).toBe("hola-mundo");
	});

	it("returns an empty string when nothing usable is left", () => {
		expect(slugify("¡¡¡ ???")).toBe("");
		expect(slugify("")).toBe("");
	});

	it("limits the length without leaving a trailing hyphen", () => {
		const slug = slugify(`${"palabra ".repeat(30)}final`);

		expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
		expect(slug.endsWith("-")).toBe(false);
		expect(slug.startsWith("palabra-palabra")).toBe(true);
	});
});
