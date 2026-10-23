import { slugify } from "../../shared/text/slugify.ts";
import type { CourseImport } from "./course-import.ts";
import { type NewCourse, toMediaRef } from "./types.ts";

/** A lesson address that is unique inside one course. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export function courseFromImport(
	course: CourseImport,
	instructorIds: string[],
): NewCourse {
	const takenLessonSlugs = new Set<string>();
	let lessonCount = 0;

	return {
		slug: course.slug,
		name: course.name,
		shortDescription: course.shortDescription ?? null,
		longDescription: course.longDescription ?? null,
		coverImages: course.coverImages.map(toMediaRef),
		promoVideo: course.promoVideo ? toMediaRef(course.promoVideo) : null,
		requirements: course.requirements,
		learningGoals: course.learningGoals,
		targetStudents: course.targetStudents,
		instructorIds,
		modules: course.modules.map((module) => ({
			title: module.title,
			description: module.description ?? null,
			position: module.order,
			lessons: module.classes.map((lesson) => {
				lessonCount += 1;
				const slug = uniqueSlug(
					slugify(lesson.title) || `clase-${lessonCount}`,
					takenLessonSlugs,
				);
				takenLessonSlugs.add(slug);
				return {
					slug,
					title: lesson.title,
					description: lesson.description ?? null,
					position: lesson.order,
					videos: lesson.videos.map(toMediaRef),
					notes: lesson.notes.map(toMediaRef),
					embedUrl: lesson.embed?.url ?? null,
					embedPassingScore: lesson.embed?.passingScore ?? 60,
					embedVerifiedOnly: lesson.embed?.verifiedOnly ?? false,
				};
			}),
		})),
	};
}

export type UploadSlot = {
	path: string;
	kind: "cover" | "promo" | "video" | "note";
	ref: string;
	name: string;
};

/** Every file the creator still has to upload, with where it belongs in the JSON. */
export function uploadSlotsOf(course: CourseImport): UploadSlot[] {
	const slot = (path: string, kind: UploadSlot["kind"], ref: string) => ({
		path,
		kind,
		ref,
		name: toMediaRef(ref).name,
	});

	const slots: UploadSlot[] = course.coverImages.map((ref, i) =>
		slot(`coverImages[${i}]`, "cover", ref),
	);
	if (course.promoVideo) {
		slots.push(slot("promoVideo", "promo", course.promoVideo));
	}
	course.modules.forEach((module, m) => {
		module.classes.forEach((lesson, c) => {
			const base = `modules[${m}].classes[${c}]`;
			for (const [i, ref] of lesson.videos.entries()) {
				slots.push(slot(`${base}.videos[${i}]`, "video", ref));
			}
			for (const [i, ref] of lesson.notes.entries()) {
				slots.push(slot(`${base}.notes[${i}]`, "note", ref));
			}
		});
	});
	return slots;
}
