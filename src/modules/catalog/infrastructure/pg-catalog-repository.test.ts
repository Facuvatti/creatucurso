import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createSchemaDatabase,
	type SchemaDatabase,
} from "../../../shared/database/schema-database.ts";
import { type NewCourse, SlugTakenError, toMediaRef } from "../domain/types.ts";
import { createPgCatalogRepository } from "./pg-catalog-repository.ts";

function newCourse(
	slug: string,
	overrides: Partial<NewCourse> = {},
): NewCourse {
	return {
		slug,
		name: `Curso ${slug}`,
		shortDescription: "Corta",
		longDescription: null,
		coverImages: [toMediaRef("C:/portada.webp")],
		promoVideo: null,
		requirements: ["Internet"],
		learningGoals: ["Aprender"],
		targetStudents: [],
		instructorIds: [],
		modules: [
			{
				title: "Módulo 2",
				description: null,
				position: 2,
				lessons: [
					{
						slug: "b",
						title: "B",
						description: null,
						position: 1,
						videos: [toMediaRef("b.mp4")],
						notes: [],
					},
				],
			},
			{
				title: "Módulo 1",
				description: "Primero",
				position: 1,
				lessons: [
					{
						slug: "a",
						title: "A",
						description: "Clase A",
						position: 1,
						videos: [toMediaRef("a.mp4")],
						notes: [toMediaRef("a.pdf")],
					},
					{
						slug: "a2",
						title: "A2",
						description: null,
						position: 2,
						videos: [],
						notes: [],
					},
				],
			},
		],
		...overrides,
	};
}

describe("createPgCatalogRepository", () => {
	let db: SchemaDatabase;
	const repo = () => createPgCatalogRepository(db.pool);

	beforeAll(async () => {
		db = await createSchemaDatabase();
		await db.pool.query(`
			insert into auth."user" (id, name, email, "emailVerified") values
			 ('u1', 'Ana', 'ana@example.com', true),
			 ('u2', 'Beto', 'beto@example.com', true);
			insert into auth.organization (id, name, slug, "createdAt") values
			 ('o1', 'Uno', 'uno', now()), ('o2', 'Dos', 'dos', now());
		`);
	});

	afterAll(async () => {
		await db?.close();
	});

	it("stores a course with ordered modules and lessons", async () => {
		const { id } = await repo().createCourse("o1", newCourse("orden"));

		const course = await repo().findById("o1", id);

		expect(course?.modules.map((m) => m.title)).toEqual([
			"Módulo 1",
			"Módulo 2",
		]);
		expect(course?.modules[0]?.lessons.map((l) => l.slug)).toEqual(["a", "a2"]);
		expect(course?.modules[0]?.lessons[0]?.notes[0]?.name).toBe("a.pdf");
		expect(course?.status).toBe("draft");
	});

	it("keeps an address unique inside one academy but not across academies", async () => {
		await repo().createCourse("o1", newCourse("repetido"));

		await expect(
			repo().createCourse("o1", newCourse("repetido")),
		).rejects.toBeInstanceOf(SlugTakenError);
		await expect(
			repo().createCourse("o2", newCourse("repetido")),
		).resolves.toBeTruthy();
	});

	it("does not leave a half-created course when something fails", async () => {
		const broken = newCourse("roto", { instructorIds: ["no-existe"] });

		await expect(repo().createCourse("o1", broken)).rejects.toThrow();

		expect(await repo().findBySlug("o1", "roto")).toBeNull();
	});

	it("never mixes academies", async () => {
		const { id } = await repo().createCourse("o1", newCourse("privado"));

		expect(await repo().findById("o2", id)).toBeNull();
		expect(await repo().findBySlug("o2", "privado")).toBeNull();
		expect(await repo().setStatus("o2", id, "published")).toBe(false);
	});

	it("lists only published courses when asked", async () => {
		const { id } = await repo().createCourse("o2", newCourse("visible"));
		await repo().setStatus("o2", id, "published");

		const published = await repo().listCourses("o2", { publishedOnly: true });
		const all = await repo().listCourses("o2", { publishedOnly: false });

		expect(published.map((c) => c.slug)).toEqual(["visible"]);
		expect(all.length).toBeGreaterThan(published.length);
	});

	it("keeps the old address working after a rename", async () => {
		const { id } = await repo().createCourse("o1", newCourse("viejo"));

		await repo().renameSlug("o1", id, "nuevo");

		expect(await repo().findBySlug("o1", "viejo")).toEqual({
			kind: "moved",
			slug: "nuevo",
		});
		expect(await repo().findBySlug("o1", "nuevo")).toMatchObject({
			kind: "found",
		});
		await expect(
			repo().renameSlug("o1", id, "repetido"),
		).rejects.toBeInstanceOf(SlugTakenError);
	});

	it("adds modules and lessons at the end with their own addresses", async () => {
		const { id } = await repo().createCourse("o1", newCourse("crece"));
		await repo().addModule(id, "Módulo 3");
		const course = await repo().findById("o1", id);
		const moduleId = course?.modules.at(-1)?.id as string;

		await repo().addLesson(moduleId, { title: "A", description: null });

		const updated = await repo().findById("o1", id);
		expect(updated?.modules.at(-1)?.position).toBe(3);
		expect(updated?.modules.at(-1)?.lessons[0]?.slug).toBe("a-2");
	});

	it("enrols once and tracks progress until the course is complete", async () => {
		const { id } = await repo().createCourse("o1", newCourse("estudio"));
		const course = await repo().findById("o1", id);
		const [first, second] = course?.modules[0]?.lessons ?? [];
		const third = course?.modules[1]?.lessons[0];

		expect(
			await repo().enroll({ courseId: id, userId: "u1", source: "manual" }),
		).toBe(true);
		expect(
			await repo().enroll({ courseId: id, userId: "u1", source: "manual" }),
		).toBe(false);
		expect(await repo().findEnrollment(id, "u2")).toBeNull();

		expect(await repo().completeLesson(id, first?.id as string, "u1")).toEqual({
			courseCompleted: false,
			justCompleted: false,
		});
		await repo().completeLesson(id, second?.id as string, "u1");
		expect(await repo().completedLessonIds(id, "u1")).toHaveLength(2);

		const last = await repo().completeLesson(id, third?.id as string, "u1");
		expect(last).toEqual({ courseCompleted: true, justCompleted: true });
		expect((await repo().findEnrollment(id, "u1"))?.completedAt).not.toBeNull();

		const again = await repo().completeLesson(id, third?.id as string, "u1");
		expect(again).toEqual({ courseCompleted: true, justCompleted: false });
	});
});
