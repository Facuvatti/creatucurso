import { describe, expect, it } from "vitest";
import {
	courseFromImport,
	uniqueSlug,
	uploadSlotsOf,
} from "./course-from-import.ts";
import { type CourseImport, parseCourseImport } from "./course-import.ts";

function parsed(overrides: Record<string, unknown> = {}): CourseImport {
	const result = parseCourseImport({
		name: "Curso",
		shortDescription: "Descripción",
		coverImages: ["C:/media/portada.webp"],
		promoVideo: "C:/media/promo.mp4",
		modules: [
			{
				title: "M1",
				classes: [
					{
						title: "Clase",
						videos: ["C:/media/a.mp4", "D:\\otros\\b.mp4"],
						notes: ["/home/maria/apunte.pdf"],
					},
					{ title: "Clase", videos: ["c.mp4"] },
				],
			},
		],
		...overrides,
	});
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.course;
}

describe("uniqueSlug", () => {
	it("keeps a free slug and numbers a taken one", () => {
		expect(uniqueSlug("clase", new Set())).toBe("clase");
		expect(uniqueSlug("clase", new Set(["clase"]))).toBe("clase-2");
		expect(uniqueSlug("clase", new Set(["clase", "clase-2"]))).toBe("clase-3");
	});
});

describe("courseFromImport", () => {
	it("gives lessons with the same title different addresses", () => {
		const course = courseFromImport(parsed(), []);
		const slugs = course.modules.flatMap((m) => m.lessons.map((l) => l.slug));

		expect(slugs).toEqual(["clase", "clase-2"]);
	});

	it("falls back to a numbered address when the title has no letters", () => {
		const course = courseFromImport(
			parsed({
				modules: [
					{ title: "M", classes: [{ title: "¡¡¡", videos: ["v.mp4"] }] },
				],
			}),
			[],
		);

		expect(course.modules[0]?.lessons[0]?.slug).toBe("clase-1");
	});

	it("keeps media as pending references with the file name", () => {
		const course = courseFromImport(parsed(), []);
		const lesson = course.modules[0]?.lessons[0];

		expect(lesson?.videos).toEqual([
			{ ref: "C:/media/a.mp4", name: "a.mp4", status: "pending" },
			{ ref: "D:\\otros\\b.mp4", name: "b.mp4", status: "pending" },
		]);
		expect(course.promoVideo?.name).toBe("promo.mp4");
	});
});

describe("uploadSlotsOf", () => {
	it("lists every file with its place in the JSON", () => {
		const slots = uploadSlotsOf(parsed());

		expect(slots.map((s) => [s.path, s.kind, s.name])).toEqual([
			["coverImages[0]", "cover", "portada.webp"],
			["promoVideo", "promo", "promo.mp4"],
			["modules[0].classes[0].videos[0]", "video", "a.mp4"],
			["modules[0].classes[0].videos[1]", "video", "b.mp4"],
			["modules[0].classes[0].notes[0]", "note", "apunte.pdf"],
			["modules[0].classes[1].videos[0]", "video", "c.mp4"],
		]);
	});
});
