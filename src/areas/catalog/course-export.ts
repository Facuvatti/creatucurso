import type { CourseImport } from "./course-import.ts";
import type { CourseOutline } from "./types.ts";

/**
 * The inverse of the importer: the course in the format of
 * docs/formato_curso_por_mcp.md. Media entries carry the original path the
 * creator wrote (the server never stores real local paths of its own).
 */
export function courseToImport(course: CourseOutline): CourseImport {
	return {
		name: course.name,
		slug: course.slug,
		...(course.shortDescription
			? { shortDescription: course.shortDescription }
			: {}),
		...(course.longDescription
			? { longDescription: course.longDescription }
			: {}),
		coverImages: course.coverImages.map((m) => m.ref),
		...(course.promoVideo ? { promoVideo: course.promoVideo.ref } : {}),
		instructors: course.instructorIds,
		requirements: course.requirements,
		learningGoals: course.learningGoals,
		targetStudents: course.targetStudents,
		modules: course.modules.map((module, m) => ({
			title: module.title,
			...(module.description ? { description: module.description } : {}),
			order: m + 1,
			classes: module.lessons.map((lesson, l) => ({
				title: lesson.title,
				...(lesson.description ? { description: lesson.description } : {}),
				order: l + 1,
				videos: lesson.videos.map((v) => v.ref),
				notes: lesson.notes.map((n) => n.ref),
				...(lesson.embedUrl
					? {
							embed: {
								url: lesson.embedUrl,
								passingScore: lesson.embedPassingScore,
								verifiedOnly: lesson.embedVerifiedOnly,
							},
						}
					: {}),
			})),
		})),
	};
}
