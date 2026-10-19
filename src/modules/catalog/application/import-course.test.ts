import { describe, expect, it } from "vitest";
import { type NewCourse, SlugTakenError } from "../domain/types.ts";
import { importCourse } from "./import-course.ts";

const valid = (extra: Record<string, unknown> = {}) => ({
	name: "Curso",
	shortDescription: "Descripción",
	modules: [{ title: "M", classes: [{ title: "C", videos: ["v.mp4"] }] }],
	...extra,
});

function setup(options: { slugTaken?: boolean } = {}) {
	const created: NewCourse[] = [];
	const deps = {
		organizationId: "org_1",
		catalog: {
			async createCourse(_org: string, course: NewCourse) {
				if (options.slugTaken) throw new SlugTakenError(course.slug);
				created.push(course);
				return { id: "course_1" };
			},
		},
		rolesOf: async (userId: string) =>
			({ tutor_1: ["tutor"], student_1: ["student"] })[userId] ?? [],
	};
	return { deps, created };
}

describe("importCourse", () => {
	it("creates the course and returns the files still to upload", async () => {
		const { deps, created } = setup();

		const result = await importCourse(valid(), deps);

		expect(result).toMatchObject({
			ok: true,
			courseId: "course_1",
			slug: "curso",
		});
		expect(created).toHaveLength(1);
		if (result.ok) expect(result.uploadSlots).toHaveLength(1);
	});

	it("reports validation problems without creating anything", async () => {
		const { deps, created } = setup();

		const result = await importCourse({ name: "Sin módulos" }, deps);

		expect(result.ok).toBe(false);
		expect(created).toHaveLength(0);
	});

	it("accepts instructors who are owner, admin or tutor of the academy", async () => {
		const { deps, created } = setup();

		const result = await importCourse(
			valid({ instructors: ["tutor_1"] }),
			deps,
		);

		expect(result.ok).toBe(true);
		expect(created[0]?.instructorIds).toEqual(["tutor_1"]);
	});

	it("rejects instructors who are students or not members", async () => {
		const { deps, created } = setup();

		const result = await importCourse(
			valid({ instructors: ["tutor_1", "student_1", "stranger"] }),
			deps,
		);

		expect(result).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({ path: "instructors[1]" }),
				expect.objectContaining({ path: "instructors[2]" }),
			],
		});
		expect(created).toHaveLength(0);
	});

	it("reports an address that is already used", async () => {
		const { deps } = setup({ slugTaken: true });

		const result = await importCourse(valid(), deps);

		expect(result).toEqual({
			ok: false,
			errors: [expect.objectContaining({ path: "slug" })],
		});
	});
});
