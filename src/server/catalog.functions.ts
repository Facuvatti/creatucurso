import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { importCourse } from "../modules/catalog/application/import-course.ts";
import type { UploadSlot } from "../modules/catalog/domain/course-from-import.ts";
import type { ImportIssue } from "../modules/catalog/domain/course-import.ts";
import {
	allLessons,
	type CourseOutline,
	type CourseSummary,
	type Lesson,
	SlugTakenError,
} from "../modules/catalog/domain/types.ts";
import { can } from "../modules/identity/domain/can.ts";
import { slugify } from "../shared/text/slugify.ts";
import { auth } from "./auth.server.ts";
import {
	getCatalog,
	getMembershipReader,
	getUserDirectory,
} from "./container.server.ts";
import {
	type RequestContext,
	requireStaffContext,
	requireTenantContext,
} from "./request.server.ts";

export type CourseAccess = {
	signedIn: boolean;
	canManage: boolean;
	isInstructor: boolean;
	enrolled: boolean;
	canStudy: boolean;
};

async function accessFor(
	context: RequestContext,
	course: CourseOutline,
): Promise<CourseAccess> {
	const { user, roles } = context;
	const canManage = can(roles, { course: ["update"] });
	const isInstructor =
		!!user && roles.includes("tutor") && course.instructorIds.includes(user.id);
	const enrolled = user
		? (await getCatalog().findEnrollment(course.id, user.id)) !== null
		: false;
	return {
		signedIn: !!user,
		canManage,
		isInstructor,
		enrolled,
		canStudy: canManage || isInstructor || enrolled,
	};
}

// ---------------------------------------------------------------- public reads

export const getTenantCatalog = createServerFn({ method: "GET" }).handler(
	async (): Promise<CourseSummary[]> => {
		const { tenant } = await requireTenantContext();
		return getCatalog().listCourses(tenant.id, { publishedOnly: true });
	},
);

export type CoursePageData =
	| {
			kind: "found";
			course: CourseOutline;
			access: CourseAccess;
			completedLessonIds: string[];
	  }
	| { kind: "moved"; slug: string }
	| { kind: "notFound" };

const courseSlugInput = z.object({ courseSlug: z.string().min(1).max(200) });

export const getCoursePage = createServerFn({ method: "GET" })
	.validator((data: unknown) => courseSlugInput.parse(data))
	.handler(async ({ data }): Promise<CoursePageData> => {
		const context = await requireTenantContext();
		const lookup = await getCatalog().findBySlug(
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
				? await getCatalog().completedLessonIds(course.id, context.user.id)
				: [];
		return { kind: "found", course, access, completedLessonIds };
	});

// ------------------------------------------------------------------ learning

const lessonInput = z.object({
	courseSlug: z.string().min(1).max(200),
	lessonSlug: z.string().min(1).max(200),
});

export type LessonPageData =
	| {
			kind: "ok";
			course: { name: string; slug: string };
			moduleTitle: string;
			lesson: Lesson;
			previous: { slug: string; title: string } | null;
			next: { slug: string; title: string } | null;
			completed: boolean;
			canTrackProgress: boolean;
	  }
	| { kind: "login" }
	| { kind: "enroll"; course: { name: string; slug: string } }
	| { kind: "notFound" };

export const getLessonPage = createServerFn({ method: "GET" })
	.validator((data: unknown) => lessonInput.parse(data))
	.handler(async ({ data }): Promise<LessonPageData> => {
		const context = await requireTenantContext();
		const lookup = await getCatalog().findBySlug(
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
				? await getCatalog().completedLessonIds(course.id, context.user.id)
				: [];
		const brief = (l: Lesson | undefined) =>
			l ? { slug: l.slug, title: l.title } : null;

		return {
			kind: "ok",
			course: { name: course.name, slug: course.slug },
			moduleTitle: module?.title ?? "",
			lesson,
			previous: brief(lessons[index - 1]),
			next: brief(lessons[index + 1]),
			completed: completedIds.includes(lesson.id),
			canTrackProgress: access.enrolled,
		};
	});

export const completeLesson = createServerFn({ method: "POST" })
	.validator((data: unknown) => lessonInput.parse(data))
	.handler(async ({ data }) => {
		const context = await requireTenantContext();
		const { user } = context;
		if (!user) return { ok: false as const };

		const lookup = await getCatalog().findBySlug(
			context.tenant.id,
			data.courseSlug,
		);
		if (!lookup || lookup.kind !== "found") return { ok: false as const };
		const lesson = allLessons(lookup.course).find(
			(l) => l.slug === data.lessonSlug,
		);
		const enrolled = await getCatalog().findEnrollment(
			lookup.course.id,
			user.id,
		);
		if (!lesson || !enrolled) return { ok: false as const };

		const result = await getCatalog().completeLesson(
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
		return getCatalog().listCourses(tenant.id, { publishedOnly: false });
	},
);

const createCourseInput = z.object({
	name: z.string().trim().min(2).max(150),
	slug: z.string().trim().toLowerCase().max(80),
	shortDescription: z.string().trim().max(300),
});

export type ActionResult = { ok: true } | { ok: false; message: string };

export const createBasicCourse = createServerFn({ method: "POST" })
	.validator((data: unknown) => createCourseInput.parse(data))
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
			const { id } = await getCatalog().createCourse(tenant.id, {
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
	.validator((data: unknown) =>
		z.object({ json: z.string().min(2).max(2_000_000) }).parse(data),
	)
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

		return importCourse(input, {
			organizationId: tenant.id,
			catalog: getCatalog(),
			rolesOf: (userId) => getMembershipReader().findRoles(tenant.id, userId),
		});
	});

const courseIdInput = z.object({ courseId: z.string().uuid() });

export const getPanelCourse = createServerFn({ method: "GET" })
	.validator((data: unknown) => courseIdInput.parse(data))
	.handler(async ({ data }): Promise<CourseOutline | null> => {
		const { tenant } = await requireStaffContext();
		return getCatalog().findById(tenant.id, data.courseId);
	});

export const setCourseStatus = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		courseIdInput
			.extend({ status: z.enum(["draft", "published"]) })
			.parse(data),
	)
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await getCatalog().findById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		if (data.status === "published" && allLessons(course).length === 0) {
			return {
				ok: false,
				message: "Agregá al menos un módulo con una clase antes de publicar.",
			};
		}
		await getCatalog().setStatus(tenant.id, data.courseId, data.status);
		return { ok: true };
	});

export const addModule = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		courseIdInput
			.extend({ title: z.string().trim().min(1).max(150) })
			.parse(data),
	)
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await getCatalog().findById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		await getCatalog().addModule(course.id, data.title);
		return { ok: true };
	});

export const addLesson = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		courseIdInput
			.extend({
				moduleId: z.string().uuid(),
				title: z.string().trim().min(1).max(150),
				description: z.string().trim().max(2000),
			})
			.parse(data),
	)
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await getCatalog().findById(tenant.id, data.courseId);
		if (!course?.modules.some((m) => m.id === data.moduleId)) {
			return { ok: false, message: "No encontramos el módulo." };
		}
		await getCatalog().addLesson(data.moduleId, {
			title: data.title,
			description: data.description || null,
		});
		return { ok: true };
	});

export const enrollStudentByEmail = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		courseIdInput.extend({ email: z.string().trim().email() }).parse(data),
	)
	.handler(async ({ data }): Promise<ActionResult> => {
		const { tenant } = await requireStaffContext();
		const course = await getCatalog().findById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };

		const userId = await getUserDirectory().findIdByEmail(data.email);
		if (!userId) {
			return {
				ok: false,
				message:
					"No hay ninguna cuenta con ese email. Pedile que se registre primero.",
			};
		}

		const roles = await getMembershipReader().findRoles(tenant.id, userId);
		if (roles.length === 0) {
			await auth.api.addMember({
				body: { userId, role: "student", organizationId: tenant.id },
			});
		}
		await getCatalog().enroll({
			courseId: course.id,
			userId,
			source: "manual",
		});
		return { ok: true };
	});
