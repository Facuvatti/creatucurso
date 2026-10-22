import { createServerFn } from "@tanstack/react-start";
import {
	creatorBlockMessage,
	enrollmentBlock,
} from "../areas/billing/billing.ts";
import * as catalog from "../areas/catalog/catalog.ts";
import { courseToImport } from "../areas/catalog/course-export.ts";
import type { UploadSlot } from "../areas/catalog/course-from-import.ts";
import type { ImportIssue } from "../areas/catalog/course-import.ts";
import {
	allLessons,
	type CourseOutline,
	type CourseSummary,
	type Lesson,
	SlugTakenError,
} from "../areas/catalog/types.ts";
import { findRoles, findUserIdByEmail } from "../areas/identity/members.ts";
import { videoOfLesson } from "../areas/media/media.ts";
import { slugify } from "../shared/text/slugify.ts";
import { email, oneOf, record, text, uuid } from "../shared/validate.ts";
import {
	accessFor,
	assertEnrollment,
	type CourseAccess,
} from "./access.server.ts";
import { auth } from "./auth.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

export type { CourseAccess };

// ---------------------------------------------------------------- public reads

export type CoursePageData =
	| {
			kind: "found";
			course: CourseOutline;
			access: CourseAccess;
			completedLessonIds: string[];
	  }
	| { kind: "moved"; slug: string }
	| { kind: "notFound" };

/** Trust-boundary checks for the inputs shared by several functions. */
function checkCourseSlug(data: unknown) {
	return { courseSlug: text(record(data), "courseSlug", 200, 1) };
}

function checkLesson(data: unknown) {
	const input = record(data);
	return {
		courseSlug: text(input, "courseSlug", 200, 1),
		lessonSlug: text(input, "lessonSlug", 200, 1),
	};
}

function checkCourseId(data: unknown) {
	return { courseId: uuid(record(data), "courseId") };
}

export const getCoursePage = createServerFn({ method: "GET" })
	.validator(checkCourseSlug)
	.handler(async ({ data }): Promise<CoursePageData> => {
		const context = await requireTenantContext();
		const lookup = await catalog.findCourseBySlug(
			context.tenant.id,
			data.courseSlug,
		);
		if (!lookup) return { kind: "notFound" };
		if (lookup.kind === "moved") return { kind: "moved", slug: lookup.slug };

		const { course } = lookup;
		const access = await accessFor(context, course);
		const visible =
			course.status === "published" || access.canManage || access.isInstructor;
		if (!visible) return { kind: "notFound" };

		const completedLessonIds =
			access.enrolled && context.user
				? await catalog.completedLessonIds(course.id, context.user.id)
				: [];
		return { kind: "found", course, access, completedLessonIds };
	});

// ------------------------------------------------------------------ learning

export type LessonPageData =
	| {
			kind: "ok";
			course: { name: string; slug: string };
			moduleTitle: string;
			lesson: Lesson;
			/** The lesson's protected video (played through /api/media), when it has one. */
			video: { status: string } | null;
			previous: { slug: string; title: string } | null;
			next: { slug: string; title: string } | null;
			completed: boolean;
			canTrackProgress: boolean;
	  }
	| { kind: "login" }
	| { kind: "enroll"; course: { name: string; slug: string } }
	| { kind: "notFound" };

export const getLessonPage = createServerFn({ method: "GET" })
	.validator(checkLesson)
	.handler(async ({ data }): Promise<LessonPageData> => {
		const context = await requireTenantContext();
		const lookup = await catalog.findCourseBySlug(
			context.tenant.id,
			data.courseSlug,
		);
		if (!lookup || lookup.kind !== "found") return { kind: "notFound" };

		const { course } = lookup;
		const access = await accessFor(context, course);
		if (course.status !== "published" && !access.canStudy) {
			return { kind: "notFound" };
		}
		if (!access.canStudy) {
			return access.signedIn
				? { kind: "enroll", course: { name: course.name, slug: course.slug } }
				: { kind: "login" };
		}

		const lessons = allLessons(course);
		const index = lessons.findIndex((l) => l.slug === data.lessonSlug);
		const lesson = lessons[index];
		if (!lesson) return { kind: "notFound" };

		const module = course.modules.find((m) =>
			m.lessons.some((l) => l.id === lesson.id),
		);
		const completedIds =
			access.enrolled && context.user
				? await catalog.completedLessonIds(course.id, context.user.id)
				: [];
		const video = await videoOfLesson(lesson.id);
		const brief = (l: Lesson | undefined) =>
			l ? { slug: l.slug, title: l.title } : null;

		return {
			kind: "ok",
			course: { name: course.name, slug: course.slug },
			moduleTitle: module?.title ?? "",
			lesson,
			video: video ? { status: video.status } : null,
			previous: brief(lessons[index - 1]),
			next: brief(lessons[index + 1]),
			completed: completedIds.includes(lesson.id),
			canTrackProgress: access.enrolled,
		};
	});

export const completeLesson = createServerFn({ method: "POST" })
	.validator(checkLesson)
	.handler(async ({ data }) => {
		const context = await requireTenantContext();
		const { user } = context;
		if (!user) return { ok: false as const };

		const lookup = await catalog.findCourseBySlug(
			context.tenant.id,
			data.courseSlug,
		);
		if (!lookup || lookup.kind !== "found") return { ok: false as const };
		const lesson = allLessons(lookup.course).find(
			(l) => l.slug === data.lessonSlug,
		);
		if (!lesson) return { ok: false as const };
		await assertEnrollment(user, lookup.course);

		const result = await catalog.completeLesson(
			lookup.course.id,
			lesson.id,
			user.id,
		);
		return { ok: true as const, courseCompleted: result.courseCompleted };
	});

// ---------------------------------------------------------------------- panel

export const getPanelCourses = createServerFn({ method: "GET" }).handler(
	async (): Promise<CourseSummary[]> => {
		const { tenant } = await requireStaffContext();
		return catalog.listCourses(tenant.id, { publishedOnly: false });
	},
);

export type ActionResult = { ok: true } | { ok: false; message: string };

export const createBasicCourse = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			name: text(input, "name", 150, 2),
			slug: text(input, "slug", 80).toLowerCase(),
			shortDescription: text(input, "shortDescription", 300),
		};
	})
	.handler(async ({ data }): Promise<ActionResult & { courseId?: string }> => {
		const { tenant } = await requireStaffContext();
		const slug = data.slug || slugify(data.name);
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
			return {
				ok: false,
				message: "La dirección solo puede tener minúsculas, números y guiones.",
			};
		}
		try {
			const { id } = await catalog.createCourse(tenant.id, {
				slug,
				name: data.name,
				shortDescription: data.shortDescription || null,
				longDescription: null,
				coverImages: [],
				promoVideo: null,
				requirements: [],
				learningGoals: [],
				targetStudents: [],
				instructorIds: [],
				modules: [],
			});
			return { ok: true, courseId: id };
		} catch (error) {
			if (!(error instanceof SlugTakenError)) throw error;
			return {
				ok: false,
				message: "Ya existe un curso con esa dirección. Elegí otra.",
			};
		}
	});

export type ImportResponse =
	| { ok: true; courseId: string; slug: string; uploadSlots: UploadSlot[] }
	| { ok: false; errors: ImportIssue[] };

export const importCourseJson = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const json = record(data).json;
		if (
			typeof json !== "string" ||
			json.length < 2 ||
			json.length > 2_000_000
		) {
			throw new Error("json must be text of up to 2 MB.");
		}
		return { json };
	})
	.handler(async ({ data }): Promise<ImportResponse> => {
		const { tenant } = await requireStaffContext();

		let input: unknown;
		try {
			input = JSON.parse(data.json);
		} catch {
			return {
				ok: false,
				errors: [{ path: "$", message: "El archivo no es un JSON válido." }],
			};
		}

		return catalog.importCourse(tenant.id, input);
	});

export const getPanelCourse = createServerFn({ method: "GET" })
	.validator(checkCourseId)
	.handler(async ({ data }): Promise<CourseOutline | null> => {
		const { tenant } = await requireStaffContext();
		return catalog.findCourseById(tenant.id, data.courseId);
	});

export const setCourseStatus = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		status: oneOf(record(data), "status", ["draft", "published"] as const),
	}))
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		if (data.status === "published" && allLessons(course).length === 0) {
			return {
				ok: false,
				message: "Agregá al menos un módulo con una clase antes de publicar.",
			};
		}
		await catalog.setCourseStatus(tenant.id, data.courseId, data.status);
		return { ok: true };
	});

export const addModule = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		title: text(record(data), "title", 150, 1),
	}))
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		await catalog.addModule(course.id, data.title);
		return { ok: true };
	});

export const addLesson = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			moduleId: uuid(input, "moduleId"),
			title: text(input, "title", 150, 1),
			description: text(input, "description", 2000),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		if (!course?.modules.some((m) => m.id === data.moduleId)) {
			return { ok: false, message: "No encontramos el módulo." };
		}
		await catalog.addLesson(data.moduleId, {
			title: data.title,
			description: data.description || null,
		});
		return { ok: true };
	});

export const enrollStudentByEmail = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		email: email(record(data), "email"),
	}))
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };

		const userId = await findUserIdByEmail(data.email);
		if (!userId) {
			return {
				ok: false,
				message:
					"No hay ninguna cuenta con ese email. Pedile que se registre primero.",
			};
		}

		// Trial student limit and suspension (ADR-0029).
		const block = await enrollmentBlock(tenant.id, userId);
		if (block) return { ok: false, message: creatorBlockMessage(block) };

		const roles = await findRoles(tenant.id, userId);
		if (roles.length === 0) {
			await auth.api.addMember({
				body: { userId, role: "student", organizationId: tenant.id },
			});
		}
		await catalog.enroll({
			courseId: course.id,
			userId,
			source: "manual",
		});
		return { ok: true };
	});

// ------------------------------------------------------------- content editing

/** The course of this academy, or null; every edit below starts from here. */
async function staffCourse(courseId: string) {
	const { tenant } = await requireStaffContext();
	return { tenant, course: await catalog.findCourseById(tenant.id, courseId) };
}

const NO_COURSE: ActionResult = {
	ok: false,
	message: "No encontramos el curso.",
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const updateCourseDetails = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			name: text(input, "name", 150, 2),
			shortDescription: text(input, "shortDescription", 300),
			longDescription: text(input, "longDescription", 10000),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		await catalog.updateCourseDetails(tenant.id, course.id, {
			name: data.name,
			shortDescription: data.shortDescription || null,
			longDescription: data.longDescription || null,
		});
		return { ok: true };
	});

export const renameCourseSlug = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		slug: text(record(data), "slug", 80, 1).toLowerCase(),
	}))
	.handler(async ({ data }): Promise<ActionResult & { slug?: string }> => {
		const { tenant, course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		if (!SLUG.test(data.slug)) {
			return {
				ok: false,
				message: "La dirección solo puede tener minúsculas, números y guiones.",
			};
		}
		try {
			await catalog.renameCourseSlug(tenant.id, course.id, data.slug);
		} catch (error) {
			if (!(error instanceof SlugTakenError)) throw error;
			return {
				ok: false,
				message: "Ya existe un curso con esa dirección. Elegí otra.",
			};
		}
		return { ok: true, slug: data.slug };
	});

export const updateModule = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			moduleId: uuid(input, "moduleId"),
			title: text(input, "title", 150, 1),
			description: text(input, "description", 2000),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		await catalog.updateModule(course.id, data.moduleId, {
			title: data.title,
			description: data.description || null,
		});
		return { ok: true };
	});

export const updateLesson = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			lessonId: uuid(input, "lessonId"),
			title: text(input, "title", 150, 1),
			description: text(input, "description", 10000),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		await catalog.updateLesson(course.id, data.lessonId, {
			title: data.title,
			description: data.description || null,
		});
		return { ok: true };
	});

export const deleteCourseItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			kind: oneOf(input, "kind", ["module", "lesson"] as const),
			id: uuid(input, "id"),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		if (data.kind === "module") await catalog.deleteModule(course.id, data.id);
		else await catalog.deleteLesson(course.id, data.id);
		return { ok: true };
	});

export const moveCourseItem = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			...checkCourseId(data),
			kind: oneOf(input, "kind", ["module", "lesson"] as const),
			id: uuid(input, "id"),
			direction: oneOf(input, "direction", ["up", "down"] as const),
		};
	})
	.handler(async ({ data }): Promise<ActionResult> => {
		const { course } = await staffCourse(data.courseId);
		if (!course) return NO_COURSE;
		await catalog.moveItem(course.id, data.kind, data.id, data.direction);
		return { ok: true };
	});

/** The course as importable JSON text (docs/formato_curso_por_mcp.md). */
export const exportCourseJson = createServerFn({ method: "GET" })
	.validator(checkCourseId)
	.handler(
		async ({ data }): Promise<{ filename: string; json: string } | null> => {
			const { course } = await staffCourse(data.courseId);
			if (!course) return null;
			return {
				filename: `${course.slug}.json`,
				json: JSON.stringify(courseToImport(course), null, 2),
			};
		},
	);
