import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import type { CourseSummary } from "../areas/catalog/types.ts";
import * as community from "../areas/community/community.ts";
import type {
	Comment,
	FeaturedReview,
	PendingComment,
	Review,
	ReviewSummary,
} from "../areas/community/types.ts";
import {
	addRole,
	findRoles,
	findUserIdByEmail,
} from "../areas/identity/members.ts";
import { can } from "../areas/identity/permissions.ts";
import { bool, email, record, text, uuid } from "../shared/validate.ts";
import { accessFor } from "./access.server.ts";
import { auth } from "./auth.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };

// --------------------------------------------------------------- tenant home

export type CourseWithRating = CourseSummary & { rating: ReviewSummary };
export type FeaturedWithCourse = FeaturedReview & {
	courseName: string;
	courseSlug: string;
};

export const getTenantHome = createServerFn({ method: "GET" }).handler(
	async (): Promise<{
		courses: CourseWithRating[];
		featured: FeaturedWithCourse[];
	}> => {
		const { tenant } = await requireTenantContext();
		const courses = await catalog.listCourses(tenant.id, {
			publishedOnly: true,
		});
		const ids = courses.map((c) => c.id);
		const [summaries, featured] = await Promise.all([
			community.reviewSummaries(ids),
			community.featuredReviews(tenant.id, ids, 3),
		]);
		const byId = new Map(courses.map((c) => [c.id, c]));

		return {
			courses: courses.map((course) => ({
				...course,
				rating: summaries.get(course.id) ?? { count: 0, average: null },
			})),
			featured: featured.flatMap((review) => {
				const course = byId.get(review.courseId);
				return course
					? [{ ...review, courseName: course.name, courseSlug: course.slug }]
					: [];
			}),
		};
	},
);

// ------------------------------------------------------------------- reviews

function checkCourse(data: unknown) {
	return { courseSlug: text(record(data), "courseSlug", 200, 1) };
}

export type ReviewsData = {
	summary: ReviewSummary;
	reviews: Review[];
	mine: Review | null;
	canReview: boolean;
	canModerate: boolean;
};

async function visibleCourse(organizationId: string, slug: string) {
	const lookup = await catalog.findCourseBySlug(organizationId, slug);
	return lookup?.kind === "found" ? lookup.course : null;
}

export const getCourseReviews = createServerFn({ method: "GET" })
	.validator(checkCourse)
	.handler(async ({ data }): Promise<ReviewsData | null> => {
		const context = await requireTenantContext();
		const course = await visibleCourse(context.tenant.id, data.courseSlug);
		if (!course) return null;

		const access = await accessFor(context, course);
		if (
			course.status !== "published" &&
			!access.canManage &&
			!access.isInstructor
		) {
			return null;
		}

		const canModerate = can(context.roles, { review: ["moderate"] });
		const [reviews, summaries, mine] = await Promise.all([
			community.listReviews(course.id, {
				includeHidden: canModerate,
				limit: 50,
			}),
			community.reviewSummaries([course.id]),
			context.user ? community.findReviewOf(course.id, context.user.id) : null,
		]);

		return {
			summary: summaries.get(course.id) ?? { count: 0, average: null },
			reviews,
			mine,
			canReview: access.enrolled && can(context.roles, { review: ["create"] }),
			canModerate,
		};
	});

export const submitReview = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const rating = input.rating;
		if (
			typeof rating !== "number" ||
			!Number.isInteger(rating) ||
			rating < 1 ||
			rating > 5
		) {
			throw new Error("rating must be a whole number from 1 to 5.");
		}
		return { ...checkCourse(data), rating, body: text(input, "body", 2000) };
	})
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const { user, tenant } = context;
		if (!user) return { ok: false, message: "Ingresá para dejar tu reseña." };

		const course = await visibleCourse(tenant.id, data.courseSlug);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		const access = await accessFor(context, course);
		if (!access.enrolled || !can(context.roles, { review: ["create"] })) {
			return {
				ok: false,
				message: "Solo quienes están inscriptos pueden dejar una reseña.",
			};
		}

		await community.saveReview({
			organizationId: tenant.id,
			courseId: course.id,
			userId: user.id,
			rating: data.rating,
			body: data.body,
		});
		return { ok: true };
	});

export const setReviewVisibility = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		reviewId: uuid(record(data), "reviewId"),
		hidden: bool(record(data), "hidden"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, roles } = await requireTenantContext();
		if (!can(roles, { review: ["moderate"] })) {
			return { ok: false, message: "No tenés permiso para moderar." };
		}
		await community.setReviewHidden(tenant.id, data.reviewId, data.hidden);
		return { ok: true };
	});

// ------------------------------------------------------------------ comments

function checkLesson(data: unknown) {
	return {
		...checkCourse(data),
		lessonSlug: text(record(data), "lessonSlug", 200, 1),
	};
}

export type CommentsData = {
	comments: Comment[];
	canPost: boolean;
	canModerate: boolean;
};

async function lessonOf(
	organizationId: string,
	courseSlug: string,
	lessonSlug: string,
) {
	const course = await visibleCourse(organizationId, courseSlug);
	const lesson = course?.modules
		.flatMap((m) => m.lessons)
		.find((l) => l.slug === lessonSlug);
	return course && lesson ? { course, lesson } : null;
}

export const getLessonComments = createServerFn({ method: "GET" })
	.validator(checkLesson)
	.handler(async ({ data }): Promise<CommentsData | null> => {
		const context = await requireTenantContext();
		const found = await lessonOf(
			context.tenant.id,
			data.courseSlug,
			data.lessonSlug,
		);
		if (!found) return null;

		const access = await accessFor(context, found.course);
		if (!access.canStudy) return null;

		const canModerate =
			can(context.roles, { comment: ["moderate"] }) &&
			(access.canManage || access.isInstructor);
		return {
			comments: await community.listComments(found.lesson.id, {
				includeHidden: canModerate,
			}),
			canPost: can(context.roles, { comment: ["create"] }),
			canModerate,
		};
	});

export const postComment = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const parentId = input.parentId;
		if (parentId !== null && typeof parentId !== "string") {
			throw new Error("parentId must be an id or null.");
		}
		return {
			...checkLesson(data),
			body: text(input, "body", 4000, 1),
			parentId: parentId === null ? null : uuid(input, "parentId"),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const { user, tenant } = context;
		if (!user) return { ok: false, message: "Ingresá para comentar." };

		const found = await lessonOf(tenant.id, data.courseSlug, data.lessonSlug);
		if (!found) return { ok: false, message: "No encontramos la clase." };
		const access = await accessFor(context, found.course);
		if (!access.canStudy || !can(context.roles, { comment: ["create"] })) {
			return { ok: false, message: "No podés comentar en esta clase." };
		}

		if (data.parentId) {
			const parent = await community.findCommentPlace(tenant.id, data.parentId);
			if (
				!parent ||
				parent.lessonId !== found.lesson.id ||
				parent.parentId !== null
			) {
				return {
					ok: false,
					message: "No se puede responder a ese comentario.",
				};
			}
		}

		await community.addComment({
			organizationId: tenant.id,
			courseId: found.course.id,
			lessonId: found.lesson.id,
			userId: user.id,
			parentId: data.parentId,
			body: data.body,
		});
		return { ok: true };
	});

export const setCommentVisibility = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		commentId: uuid(record(data), "commentId"),
		hidden: bool(record(data), "hidden"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const { user, tenant, roles } = context;
		if (!user || !can(roles, { comment: ["moderate"] })) {
			return { ok: false, message: "No tenés permiso para moderar." };
		}
		const place = await community.findCommentPlace(tenant.id, data.commentId);
		const course = place
			? await catalog.findCourseById(tenant.id, place.courseId)
			: null;
		if (!place || !course)
			return { ok: false, message: "No encontramos el comentario." };

		const access = await accessFor(context, course);
		if (!access.canManage && !access.isInstructor) {
			return {
				ok: false,
				message: "No tenés permiso para moderar este curso.",
			};
		}
		await community.setCommentHidden(tenant.id, data.commentId, data.hidden);
		return { ok: true };
	});

// -------------------------------------------------------------------- tutors

function checkCourseId(data: unknown) {
	return { courseId: uuid(record(data), "courseId") };
}

export type Tutor = { userId: string; name: string; email: string };

export const getCourseTutors = createServerFn({ method: "GET" })
	.validator(checkCourseId)
	.handler(async ({ data }): Promise<Tutor[]> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		return course ? catalog.listInstructors(course.id) : [];
	});

export const addTutorByEmail = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		email: email(record(data), "email"),
	}))
	.handler(async ({ data }): Promise<Result> => {
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

		const roles = await findRoles(tenant.id, userId);
		if (roles.length === 0) {
			await auth.api.addMember({
				body: { userId, role: "tutor", organizationId: tenant.id },
			});
		} else {
			await addRole(tenant.id, userId, "tutor");
		}
		await catalog.addInstructor(course.id, userId);
		return { ok: true };
	});

export const removeTutor = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		...checkCourseId(data),
		userId: text(record(data), "userId", 200, 1),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const course = await catalog.findCourseById(tenant.id, data.courseId);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		await catalog.removeInstructor(course.id, data.userId);
		return { ok: true };
	});

export type InboxItem = PendingComment & {
	courseName: string;
	courseSlug: string;
	lessonSlug: string;
	lessonTitle: string;
};

/** Comments waiting for an answer, for the tutor's courses (or all courses for staff). */
export const getTutorInbox = createServerFn({ method: "GET" }).handler(
	async (): Promise<InboxItem[]> => {
		const { tenant, user, roles } = await requireTenantContext();
		if (
			!user ||
			!can(roles, { comment: ["reply"] }) ||
			(roles.includes("student") && roles.length === 1)
		) {
			return [];
		}

		const isStaff = can(roles, { course: ["update"] });
		const courses = isStaff
			? await catalog.listCourses(tenant.id, { publishedOnly: false })
			: await catalog.listCoursesOfInstructor(tenant.id, user.id);
		const pending = await community.commentsAwaitingReply(
			tenant.id,
			courses.map((c) => c.id),
		);

		const outlines = new Map(
			(
				await Promise.all(
					courses.map((c) => catalog.findCourseById(tenant.id, c.id)),
				)
			).flatMap((outline) => (outline ? [[outline.id, outline] as const] : [])),
		);

		return pending.flatMap((item) => {
			const course = outlines.get(item.courseId);
			const lesson = course?.modules
				.flatMap((m) => m.lessons)
				.find((l) => l.id === item.lessonId);
			return course && lesson
				? [
						{
							...item,
							courseName: course.name,
							courseSlug: course.slug,
							lessonSlug: lesson.slug,
							lessonTitle: lesson.title,
						},
					]
				: [];
		});
	},
);
