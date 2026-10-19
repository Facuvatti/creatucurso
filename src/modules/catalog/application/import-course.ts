import {
	courseFromImport,
	type UploadSlot,
	uploadSlotsOf,
} from "../domain/course-from-import.ts";
import {
	type ImportIssue,
	parseCourseImport,
} from "../domain/course-import.ts";
import { SlugTakenError } from "../domain/types.ts";
import type { CatalogRepository } from "./catalog-repository.ts";

const INSTRUCTOR_ROLES = ["owner", "admin", "tutor"];

export type ImportCourseResult =
	| { ok: true; courseId: string; slug: string; uploadSlots: UploadSlot[] }
	| { ok: false; errors: ImportIssue[] };

type Dependencies = {
	organizationId: string;
	catalog: Pick<CatalogRepository, "createCourse">;
	/** Roles a person has in this academy (empty when they are not a member). */
	rolesOf: (userId: string) => Promise<string[]>;
};

export async function importCourse(
	input: unknown,
	{ organizationId, catalog, rolesOf }: Dependencies,
): Promise<ImportCourseResult> {
	const parsed = parseCourseImport(input);
	if (!parsed.ok) return parsed;

	const errors: ImportIssue[] = [];
	for (const [index, userId] of parsed.course.instructors.entries()) {
		const roles = await rolesOf(userId);
		if (!roles.some((role) => INSTRUCTOR_ROLES.includes(role))) {
			errors.push({
				path: `instructors[${index}]`,
				message:
					"must be a member of this academy with the owner, admin or tutor role",
			});
		}
	}
	if (errors.length > 0) return { ok: false, errors };

	try {
		const { id } = await catalog.createCourse(
			organizationId,
			courseFromImport(parsed.course, parsed.course.instructors),
		);
		return {
			ok: true,
			courseId: id,
			slug: parsed.course.slug,
			uploadSlots: uploadSlotsOf(parsed.course),
		};
	} catch (error) {
		if (error instanceof SlugTakenError) {
			return {
				ok: false,
				errors: [
					{
						path: "slug",
						message: "this address is already used by another course",
					},
				],
			};
		}
		throw error;
	}
}
