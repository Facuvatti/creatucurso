import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCourseImport } from "./course-import.ts";

function minimal() {
	return {
		name: "Intro a HTML",
		shortDescription: "Aprendé HTML desde cero.",
		modules: [
			{
				title: "Módulo 1",
				classes: [{ title: "Clase 1", videos: ["C:/videos/clase1.mp4"] }],
			},
		],
	};
}

function errorsOf(input: unknown) {
	const result = parseCourseImport(input);
	if (result.ok) throw new Error("expected the import to be rejected");
	return result.errors;
}

describe("parseCourseImport", () => {
	it("accepts a minimal course and fills in the defaults", () => {
		const result = parseCourseImport(minimal());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.course.slug).toBe("intro-a-html");
		expect(result.course.requirements).toEqual([]);
		expect(result.course.modules[0]?.order).toBe(1);
		expect(result.course.modules[0]?.classes[0]?.order).toBe(1);
		expect(result.course.modules[0]?.classes[0]?.notes).toEqual([]);
	});

	it("accepts the example provided by the owner", () => {
		const example = JSON.parse(
			readFileSync("docs/formato_curso_por_mcp.md", "utf8"),
		);

		const result = parseCourseImport(example);

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.course.slug).toBe("introduccion-desarrollo-web");
		expect(result.course.modules).toHaveLength(2);
	});

	it("keeps a slug that was provided", () => {
		const result = parseCourseImport({ ...minimal(), slug: "mi-curso" });

		expect(result).toMatchObject({ ok: true, course: { slug: "mi-curso" } });
	});

	it("generates the slug from the name when it is empty", () => {
		for (const slug of ["", "   "]) {
			const result = parseCourseImport({ ...minimal(), slug });

			expect(result).toMatchObject({
				ok: true,
				course: { slug: "intro-a-html" },
			});
		}
	});

	it("rejects a slug with the wrong format", () => {
		expect(errorsOf({ ...minimal(), slug: "Mi Curso" })).toEqual([
			expect.objectContaining({ path: "slug" }),
		]);
	});

	it("asks for a slug when none can be generated from the name", () => {
		expect(errorsOf({ ...minimal(), name: "¡¡¡" })).toEqual([
			expect.objectContaining({ path: "slug" }),
		]);
	});

	it("requires a name", () => {
		const { name: _name, ...withoutName } = minimal();

		expect(errorsOf(withoutName)).toEqual([
			expect.objectContaining({ path: "name" }),
		]);
	});

	it("requires at least one description, short or long", () => {
		const { shortDescription: _short, ...withoutDescription } = minimal();

		expect(errorsOf(withoutDescription)).toEqual([
			expect.objectContaining({ path: "shortDescription" }),
		]);
		expect(
			parseCourseImport({ ...withoutDescription, longDescription: "Largo." }),
		).toMatchObject({ ok: true });
		expect(
			errorsOf({ ...withoutDescription, longDescription: "   " }),
		).toHaveLength(1);
	});

	it("requires at least one module", () => {
		expect(errorsOf({ ...minimal(), modules: [] })).toEqual([
			expect.objectContaining({ path: "modules" }),
		]);
		const { modules: _modules, ...withoutModules } = minimal();
		expect(errorsOf(withoutModules)).toEqual([
			expect.objectContaining({ path: "modules" }),
		]);
	});

	it("requires at least one class in every module", () => {
		const course = minimal();
		course.modules.push({ title: "Vacío", classes: [] });

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[1].classes" }),
		]);
	});

	it("requires at least one video in every class", () => {
		const course = minimal();
		course.modules[0]?.classes.push({ title: "Sin video", videos: [] });

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[0].classes[1].videos" }),
		]);
	});

	it("rejects the removed durationMinutes field like any unknown field", () => {
		const course = minimal();
		Object.assign(course.modules[0]?.classes[0] ?? {}, { durationMinutes: 12 });

		const errors = errorsOf(course);

		expect(errors).toEqual([
			expect.objectContaining({ path: "modules[0].classes[0]" }),
		]);
		expect(errors[0]?.message).toContain("durationMinutes");
	});

	it("rejects unknown top-level fields so typos are caught", () => {
		const errors = errorsOf({ ...minimal(), titel: "typo" });

		expect(errors).toEqual([expect.objectContaining({ path: "$" })]);
		expect(errors[0]?.message).toContain("titel");
	});

	it("rejects input that is not an object", () => {
		for (const input of [null, "course", 42, [], undefined]) {
			expect(errorsOf(input)).toEqual([expect.objectContaining({ path: "$" })]);
		}
	});

	it("rejects empty media references", () => {
		const course = minimal();
		course.modules[0]?.classes[0]?.videos.push("   ");

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[0].classes[0].videos[1]" }),
		]);
	});

	it("rejects media references with control characters", () => {
		const course = minimal();
		course.modules[0]?.classes[0]?.videos.push("clase\u0000.mp4");

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[0].classes[0].videos[1]" }),
		]);
	});

	it("rejects more cover images than allowed", () => {
		const coverImages = Array.from({ length: 11 }, (_, i) => `cover-${i}.webp`);

		expect(errorsOf({ ...minimal(), coverImages })).toEqual([
			expect.objectContaining({ path: "coverImages" }),
		]);
	});

	it("rejects duplicated orders among siblings", () => {
		const course = minimal();
		course.modules.push({
			title: "Módulo 2",
			classes: [{ title: "Clase", videos: ["v.mp4"] }],
		});
		Object.assign(course.modules[0] ?? {}, { order: 1 });
		Object.assign(course.modules[1] ?? {}, { order: 1 });

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[1].order" }),
		]);
	});

	it("treats the position as the order when none is given", () => {
		const course = minimal();
		course.modules.push({
			title: "Módulo 2",
			classes: [{ title: "Clase", videos: ["v.mp4"] }],
		});
		Object.assign(course.modules[1] ?? {}, { order: 1 });

		expect(errorsOf(course)).toEqual([
			expect.objectContaining({ path: "modules[1].order" }),
		]);
	});

	it("sorts modules and classes by their order", () => {
		const course = minimal();
		course.modules.push({
			title: "Módulo 2",
			classes: [{ title: "Clase", videos: ["v.mp4"] }],
		});
		Object.assign(course.modules[0] ?? {}, { order: 2 });
		Object.assign(course.modules[1] ?? {}, { order: 1 });

		const result = parseCourseImport(course);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.course.modules.map((m) => m.title)).toEqual([
			"Módulo 2",
			"Módulo 1",
		]);
	});

	it("reports every problem at once", () => {
		const errors = errorsOf({ modules: [] });

		expect(errors.map((e) => e.path).sort()).toEqual(["modules", "name"]);
	});
});
