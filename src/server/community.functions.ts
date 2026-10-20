import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import type { CourseOutline, CourseSummary } from "../areas/catalog/types.ts";
import * as community from "../areas/community/community.ts";
import type {
	Comment,
	FeaturedReview,
	PendingComment,
	ReportedComment,
	Review,
	ReviewSummary,
} from "../areas/community/types.ts";
import {
	addRole,
	findRoles,
	findUserIdByEmail,
} from "../areas/identity/members.ts";
import { can } from "../areas/identity/permissions.ts";
import { bool, email, oneOf, record, text, uuid } from "../shared/validate.ts";
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
		const changed = await community.setReviewHidden(
			tenant.id,
			data.reviewId,
			data.hidden,
		);
		return changed
			? { ok: true }
			: {
					ok: false,
					message:
						"No se puede mostrar la reseña de alguien sin acceso al curso.",
				};
	});

export const saveReviewReply = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		reviewId: uuid(record(data), "reviewId"),
		body: text(record(data), "body", 2000, 1),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, user, roles } = await requireTenantContext();
		if (!user || !can(roles, { review: ["moderate"] })) {
			return { ok: false, message: "No tenés permiso para responder reseñas." };
		}
		const saved = await community.saveReviewReply({
			organizationId: tenant.id,
			reviewId: data.reviewId,
			userId: user.id,
			body: data.body,
		});
		return saved
			? { ok: true }
			: { ok: false, message: "No encontramos la reseña." };
	});

export const removeReviewReply = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({ reviewId: uuid(record(data), "reviewId") }))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, roles } = await requireTenantContext();
		if (!can(roles, { review: ["moderate"] })) {
			return { ok: false, message: "No tenés permiso para responder reseñas." };
		}
		await community.removeReviewReply(tenant.id, data.reviewId);
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
	viewerId: string | null;
	canPost: boolean;
	/** The academy silenced this person: show a message instead of the form. */
	muted: boolean;
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
		const muted = context.user
			? await community.isMuted(context.tenant.id, context.user.id)
			: false;
		return {
			comments: await community.listComments(found.lesson.id, {
				includeHidden: canModerate,
				viewerId: context.user?.id ?? null,
				seeReports: canModerate,
			}),
			viewerId: context.user?.id ?? null,
			canPost: can(context.roles, { comment: ["create"] }) && !muted,
			muted,
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
			body: text(input, "body", community.COMMENT_MAX_LENGTH, 1),
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

		return community.addComment({
			organizationId: tenant.id,
			courseId: found.course.id,
			lessonId: found.lesson.id,
			userId: user.id,
			parentId: data.parentId,
			body: data.body,
			fromTeam: access.canManage || access.isInstructor,
		});
	});

/** The comment, when this person may moderate its course (staff or its tutor). */
async function moderatedComment(
	context: Awaited<ReturnType<typeof requireTenantContext>>,
	commentId: string,
): Promise<
	| {
			ok: true;
			place: NonNullable<
				Awaited<ReturnType<typeof community.findCommentPlace>>
			>;
	  }
	| { ok: false; message: string }
> {
	if (!context.user || !can(context.roles, { comment: ["moderate"] })) {
		return { ok: false, message: "No tenés permiso para moderar." };
	}
	const place = await community.findCommentPlace(context.tenant.id, commentId);
	const course = place
		? await catalog.findCourseById(context.tenant.id, place.courseId)
		: null;
	if (!place || !course) {
		return { ok: false, message: "No encontramos el comentario." };
	}
	const access = await accessFor(context, course);
	if (!access.canManage && !access.isInstructor) {
		return { ok: false, message: "No tenés permiso para moderar este curso." };
	}
	return { ok: true, place };
}

export const setCommentVisibility = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		commentId: uuid(record(data), "commentId"),
		hidden: bool(record(data), "hidden"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const found = await moderatedComment(context, data.commentId);
		if (!found.ok) return found;
		await community.setCommentHidden(
			context.tenant.id,
			data.commentId,
			data.hidden,
		);
		return { ok: true };
	});

/** Mark a thread as answered or pin it to the top of the lesson's comments. */
export const setCommentFlag = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		commentId: uuid(record(data), "commentId"),
		flag: oneOf(record(data), "flag", ["answered", "pinned"] as const),
		value: bool(record(data), "value"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const found = await moderatedComment(context, data.commentId);
		if (!found.ok) return found;
		const changed = await community.setCommentFlag(
			context.tenant.id,
			data.commentId,
			data.flag,
			data.value,
		);
		return changed
			? { ok: true }
			: { ok: false, message: "Solo se puede marcar el comentario principal." };
	});

/** Any student, tutor or staff member who can read the lesson may report a comment. */
export const reportComment = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		commentId: uuid(record(data), "commentId"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const { user, tenant } = context;
		if (!user) return { ok: false, message: "Ingresá para reportar." };
		const place = await community.findCommentPlace(tenant.id, data.commentId);
		const course = place
			? await catalog.findCourseById(tenant.id, place.courseId)
			: null;
		if (!place || !course || place.deleted) {
			return { ok: false, message: "No encontramos el comentario." };
		}
		if (!(await accessFor(context, course)).canStudy) {
			return { ok: false, message: "No podés reportar este comentario." };
		}
		if (place.userId === user.id) {
			return { ok: false, message: "No podés reportar tu propio comentario." };
		}
		const added = await community.reportComment(data.commentId, user.id);
		return added
			? { ok: true }
			: { ok: false, message: "Ya reportaste este comentario." };
	});

export type QueueItem = ReportedComment & {
	courseName: string;
	courseSlug: string;
	lessonSlug: string;
	lessonTitle: string;
};

/** Staff and tutors see the lessons of the courses they manage, with each course's outline. */
async function manageableCourses(
	context: Awaited<ReturnType<typeof requireTenantContext>>,
) {
	const { tenant, user, roles } = context;
	if (!user || !can(roles, { comment: ["moderate"] })) return null;
	const summaries = can(roles, { course: ["update"] })
		? await catalog.listCourses(tenant.id, { publishedOnly: false })
		: await catalog.listCoursesOfInstructor(tenant.id, user.id);
	const outlines = (
		await Promise.all(
			summaries.map((c) => catalog.findCourseById(tenant.id, c.id)),
		)
	).flatMap((outline) => (outline ? [outline] : []));
	return new Map(outlines.map((outline) => [outline.id, outline]));
}

function lessonIn(course: CourseOutline | undefined, lessonId: string) {
	return course?.modules
		.flatMap((m) => m.lessons)
		.find((l) => l.id === lessonId);
}

export const getModerationQueue = createServerFn({ method: "GET" }).handler(
	async (): Promise<{ items: QueueItem[]; canMute: boolean }> => {
		const context = await requireTenantContext();
		const courses = await manageableCourses(context);
		if (!courses) return { items: [], canMute: false };
		const reported = await community.reportedComments(context.tenant.id, [
			...courses.keys(),
		]);
		return {
			canMute: can(context.roles, { course: ["update"] }),
			items: reported.flatMap((item) => {
				const course = courses.get(item.courseId);
				const lesson = lessonIn(course, item.lessonId);
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
			}),
		};
	},
);

/** Queue actions: drop the reports, or delete leaving a tombstone. */
export const moderateReportedComment = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		commentId: uuid(record(data), "commentId"),
		action: oneOf(record(data), "action", ["dismiss", "delete"] as const),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const context = await requireTenantContext();
		const found = await moderatedComment(context, data.commentId);
		if (!found.ok) return found;
		if (data.action === "dismiss") {
			await community.dismissReports(data.commentId);
		} else {
			await community.deleteComment(context.tenant.id, data.commentId);
		}
		return { ok: true };
	});

export const setStudentMuted = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		userId: text(record(data), "userId", 200, 1),
		muted: bool(record(data), "muted"),
	}))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		await community.setMuted(tenant.id, data.userId, data.muted);
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
				message: "Esa persona debe registrarse primero en la plataforma.",
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
		const context = await requireTenantContext();
		const courses = await manageableCourses(context);
		if (!courses) return [];
		const pending = await community.commentsAwaitingReply(context.tenant.id, [
			...courses.keys(),
		]);
		return pending.flatMap((item) => {
			const course = courses.get(item.courseId);
			const lesson = lessonIn(course, item.lessonId);
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
