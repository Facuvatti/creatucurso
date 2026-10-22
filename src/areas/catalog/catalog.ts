import type { PoolClient } from "pg";
import { emitEvent, inTransaction, pool } from "../../server/db.server.ts";
import { slugify } from "../../shared/text/slugify.ts";
import { restoreReviewAfterRefund } from "../community/community.ts";
import { findRoles } from "../identity/members.ts";
import {
	courseFromImport,
	type UploadSlot,
	uniqueSlug,
	uploadSlotsOf,
} from "./course-from-import.ts";
import { type ImportIssue, parseCourseImport } from "./course-import.ts";
import {
	type CourseOutline,
	type CourseStatus,
	type CourseSummary,
	type Lesson,
	type MediaRef,
	type Module,
	type NewCourse,
	SlugTakenError,
} from "./types.ts";

export type CourseLookup =
	| { kind: "found"; course: CourseOutline }
	| { kind: "moved"; slug: string };

export type CompletionResult = {
	courseCompleted: boolean;
	justCompleted: boolean;
};

export type ImportCourseResult =
	| { ok: true; courseId: string; slug: string; uploadSlots: UploadSlot[] }
	| { ok: false; errors: ImportIssue[] };

type CourseRow = {
	id: string;
	organization_id: string;
	slug: string;
	name: string;
	short_description: string | null;
	long_description: string | null;
	cover_images: MediaRef[];
	promo_video: MediaRef | null;
	requirements: string[];
	learning_goals: string[];
	target_students: string[];
	status: CourseStatus;
	price_amount: number | null;
	currency: string | null;
};

type ModuleRow = {
	id: string;
	title: string;
	description: string | null;
	position: number;
};

type LessonRow = {
	id: string;
	module_id: string;
	slug: string;
	title: string;
	description: string | null;
	position: number;
	videos: MediaRef[];
	notes: MediaRef[];
};

const COURSE_COLUMNS = `id, organization_id, slug, name, short_description, long_description,
	cover_images, promo_video, requirements, learning_goals, target_students, status,
	price_amount, currency`;

const INSTRUCTOR_ROLES = ["owner", "admin", "tutor"];

function toSummary(row: CourseRow): CourseSummary {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		shortDescription: row.short_description,
		status: row.status,
		priceAmount: row.price_amount,
		currency: row.currency,
	};
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
	const e = error as { code?: string; constraint?: string };
	return e.code === "23505" && e.constraint === constraint;
}

async function outlineOf(row: CourseRow): Promise<CourseOutline> {
	const [modules, lessons, instructors] = await Promise.all([
		pool.query<ModuleRow>(
			`select id, title, description, position from catalog.module
			 where course_id = $1 order by position`,
			[row.id],
		),
		pool.query<LessonRow>(
			`select id, module_id, slug, title, description, position, videos, notes
			 from catalog.lesson where course_id = $1 order by position`,
			[row.id],
		),
		pool.query<{ user_id: string }>(
			`select user_id from catalog.course_instructor where course_id = $1`,
			[row.id],
		),
	]);

	const lessonsByModule = new Map<string, Lesson[]>();
	for (const l of lessons.rows) {
		const list = lessonsByModule.get(l.module_id) ?? [];
		list.push({
			id: l.id,
			slug: l.slug,
			title: l.title,
			description: l.description,
			position: l.position,
			videos: l.videos,
			notes: l.notes,
		});
		lessonsByModule.set(l.module_id, list);
	}

	return {
		...toSummary(row),
		organizationId: row.organization_id,
		longDescription: row.long_description,
		coverImages: row.cover_images,
		promoVideo: row.promo_video,
		requirements: row.requirements,
		learningGoals: row.learning_goals,
		targetStudents: row.target_students,
		instructorIds: instructors.rows.map((r) => r.user_id),
		modules: modules.rows.map(
			(m): Module => ({
				id: m.id,
				title: m.title,
				description: m.description,
				position: m.position,
				lessons: lessonsByModule.get(m.id) ?? [],
			}),
		),
	};
}

// -------------------------------------------------------------------- courses

export async function createCourse(
	organizationId: string,
	course: NewCourse,
): Promise<{ id: string }> {
	try {
		return await inTransaction(async (client) => {
			const created = await client.query<{ id: string }>(
				`insert into catalog.course
				 (organization_id, slug, name, short_description, long_description, cover_images,
				  promo_video, requirements, learning_goals, target_students)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
				[
					organizationId,
					course.slug,
					course.name,
					course.shortDescription,
					course.longDescription,
					JSON.stringify(course.coverImages),
					course.promoVideo ? JSON.stringify(course.promoVideo) : null,
					course.requirements,
					course.learningGoals,
					course.targetStudents,
				],
			);
			const courseId = created.rows[0]?.id as string;

			for (const module of course.modules) {
				const inserted = await client.query<{ id: string }>(
					`insert into catalog.module (course_id, title, description, position)
					 values ($1, $2, $3, $4) returning id`,
					[courseId, module.title, module.description, module.position],
				);
				const moduleId = inserted.rows[0]?.id as string;
				for (const lesson of module.lessons) {
					await client.query(
						`insert into catalog.lesson
						 (course_id, module_id, slug, title, description, position, videos, notes)
						 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
						[
							courseId,
							moduleId,
							lesson.slug,
							lesson.title,
							lesson.description,
							lesson.position,
							JSON.stringify(lesson.videos),
							JSON.stringify(lesson.notes),
						],
					);
				}
			}

			for (const userId of course.instructorIds) {
				await client.query(
					`insert into catalog.course_instructor (course_id, user_id)
					 values ($1, $2) on conflict do nothing`,
					[courseId, userId],
				);
			}
			return { id: courseId };
		});
	} catch (error) {
		if (isUniqueViolation(error, "course_organization_id_slug_key")) {
			throw new SlugTakenError(course.slug);
		}
		throw error;
	}
}

/** Validates the JSON a creator pasted and creates the course from it. */
export async function importCourse(
	organizationId: string,
	input: unknown,
): Promise<ImportCourseResult> {
	const parsed = parseCourseImport(input);
	if (!parsed.ok) return parsed;

	const errors: ImportIssue[] = [];
	for (const [index, userId] of parsed.course.instructors.entries()) {
		const roles = await findRoles(organizationId, userId);
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
		const { id } = await createCourse(
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

export async function listCourses(
	organizationId: string,
	{ publishedOnly }: { publishedOnly: boolean },
): Promise<CourseSummary[]> {
	const { rows } = await pool.query<CourseRow>(
		`select ${COURSE_COLUMNS} from catalog.course
		 where organization_id = $1 and ($2::boolean = false or status = 'published')
		 order by created_at desc`,
		[organizationId, publishedOnly],
	);
	return rows.map(toSummary);
}

export async function findCourseBySlug(
	organizationId: string,
	slug: string,
): Promise<CourseLookup | null> {
	const current = await pool.query<CourseRow>(
		`select ${COURSE_COLUMNS} from catalog.course
		 where organization_id = $1 and slug = $2`,
		[organizationId, slug],
	);
	if (current.rows[0]) {
		return { kind: "found", course: await outlineOf(current.rows[0]) };
	}
	const renamed = await pool.query<{ slug: string }>(
		`select slug from catalog.course
		 where organization_id = $1 and $2 = any (previous_slugs) limit 1`,
		[organizationId, slug],
	);
	return renamed.rows[0] ? { kind: "moved", slug: renamed.rows[0].slug } : null;
}

export async function findCourseById(
	organizationId: string,
	id: string,
): Promise<CourseOutline | null> {
	const { rows } = await pool.query<CourseRow>(
		`select ${COURSE_COLUMNS} from catalog.course
		 where organization_id = $1 and id = $2`,
		[organizationId, id],
	);
	return rows[0] ? outlineOf(rows[0]) : null;
}

export async function setCourseStatus(
	organizationId: string,
	courseId: string,
	status: CourseStatus,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update catalog.course set status = $3, updated_at = now()
		 where organization_id = $1 and id = $2`,
		[organizationId, courseId, status],
	);
	return (rowCount ?? 0) > 0;
}

/** Changes the address of a course and keeps the old one so it keeps working. */
export async function renameCourseSlug(
	organizationId: string,
	courseId: string,
	newSlug: string,
): Promise<void> {
	try {
		await pool.query(
			`update catalog.course
			 set previous_slugs = case when slug = $3 then previous_slugs
			       else array_append(array_remove(previous_slugs, $3), slug) end,
			     slug = $3, updated_at = now()
			 where organization_id = $1 and id = $2`,
			[organizationId, courseId, newSlug],
		);
	} catch (error) {
		if (isUniqueViolation(error, "course_organization_id_slug_key")) {
			throw new SlugTakenError(newSlug);
		}
		throw error;
	}
}

/** Sets the price in minor units, or removes it (free course) with null. */
export async function setCoursePrice(
	organizationId: string,
	courseId: string,
	price: { amount: number; currency: string } | null,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update catalog.course set price_amount = $3, currency = $4, updated_at = now()
		 where organization_id = $1 and id = $2`,
		[organizationId, courseId, price?.amount ?? null, price?.currency ?? null],
	);
	return (rowCount ?? 0) > 0;
}

export async function addModule(courseId: string, title: string) {
	await pool.query(
		`insert into catalog.module (course_id, title, position)
		 values ($1, $2, coalesce((select max(position) from catalog.module where course_id = $1), 0) + 1)`,
		[courseId, title],
	);
}

export async function addLesson(
	moduleId: string,
	{ title, description }: { title: string; description: string | null },
) {
	await inTransaction(async (client) => {
		const module = await client.query<{ course_id: string }>(
			`select course_id from catalog.module where id = $1`,
			[moduleId],
		);
		const courseId = module.rows[0]?.course_id;
		if (!courseId) throw new Error("Module not found");

		const slugs = await client.query<{ slug: string }>(
			`select slug from catalog.lesson where course_id = $1`,
			[courseId],
		);
		const slug = uniqueSlug(
			slugify(title) || "clase",
			new Set(slugs.rows.map((r) => r.slug)),
		);
		await client.query(
			`insert into catalog.lesson (course_id, module_id, slug, title, description, position)
			 values ($1, $2, $3, $4, $5,
			   coalesce((select max(position) from catalog.lesson where module_id = $2), 0) + 1)`,
			[courseId, moduleId, slug, title, description],
		);
	});
}

// ---------------------------------------------------------------- instructors

export async function addInstructor(courseId: string, userId: string) {
	await pool.query(
		`insert into catalog.course_instructor (course_id, user_id)
		 values ($1, $2) on conflict do nothing`,
		[courseId, userId],
	);
}

export async function removeInstructor(courseId: string, userId: string) {
	await pool.query(
		`delete from catalog.course_instructor where course_id = $1 and user_id = $2`,
		[courseId, userId],
	);
}

export async function listInstructors(
	courseId: string,
): Promise<{ userId: string; name: string; email: string }[]> {
	const { rows } = await pool.query<{
		user_id: string;
		name: string;
		email: string;
	}>(
		`select i.user_id, u.name, u.email
		 from catalog.course_instructor i join auth."user" u on u.id = i.user_id
		 where i.course_id = $1 order by u.name`,
		[courseId],
	);
	return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email }));
}

/** Courses of this academy where the person is a tutor. */
export async function listCoursesOfInstructor(
	organizationId: string,
	userId: string,
): Promise<CourseSummary[]> {
	const { rows } = await pool.query<CourseRow>(
		`select ${COURSE_COLUMNS} from catalog.course
		 where organization_id = $1
		   and id in (select course_id from catalog.course_instructor where user_id = $2)
		 order by name`,
		[organizationId, userId],
	);
	return rows.map(toSummary);
}

// ---------------------------------------------------------------- enrollments

export type EnrollmentStatus = "active" | "suspended" | "refunded" | "revoked";

export async function enroll(input: {
	courseId: string;
	userId: string;
	source: "manual" | "payment" | "free";
	paymentId?: string;
}): Promise<boolean> {
	return inTransaction(async (client) => {
		// A new payment re-activates a refunded enrollment. Replaying the webhook
		// of the refunded payment itself (same payment id) does not.
		const { rows } = await client.query<{ id: string }>(
			`insert into catalog.enrollment (course_id, user_id, source, payment_id)
			 values ($1, $2, $3, $4)
			 on conflict (course_id, user_id) do update
			   set status = 'active', source = excluded.source, payment_id = excluded.payment_id,
			       created_at = now()
			   where catalog.enrollment.status = 'refunded'
			     and catalog.enrollment.payment_id is distinct from excluded.payment_id
			 returning id`,
			[input.courseId, input.userId, input.source, input.paymentId ?? null],
		);
		const created = rows[0];
		if (!created) return false;
		// A returning student (new payment after a refund) gets the refund-hidden review back.
		await restoreReviewAfterRefund(client, input.courseId, input.userId);
		await emitEvent(
			client,
			"enrollment.created",
			{
				enrollmentId: created.id,
				courseId: input.courseId,
				userId: input.userId,
				source: input.source,
			},
			`enrollment.created:${created.id}:${input.paymentId ?? "none"}`,
		);
		return true;
	});
}

/** The enrollment that grants access (status active), or null. */
export async function findEnrollment(
	courseId: string,
	userId: string,
): Promise<{ completedAt: Date | null; createdAt: Date } | null> {
	const { rows } = await pool.query<{
		completed_at: Date | null;
		created_at: Date;
	}>(
		`select completed_at, created_at from catalog.enrollment
		 where course_id = $1 and user_id = $2 and status = 'active'`,
		[courseId, userId],
	);
	return rows[0]
		? { completedAt: rows[0].completed_at, createdAt: rows[0].created_at }
		: null;
}

/** The enrollment status whatever it is, or null when the student never enrolled. */
export async function findEnrollmentStatus(
	courseId: string,
	userId: string,
): Promise<EnrollmentStatus | null> {
	const { rows } = await pool.query<{ status: EnrollmentStatus }>(
		`select status from catalog.enrollment where course_id = $1 and user_id = $2`,
		[courseId, userId],
	);
	return rows[0]?.status ?? null;
}

/**
 * Moves an enrollment from one of the `from` statuses to `to` inside the
 * caller's transaction. Returns the enrollment id when something changed.
 */
export async function setEnrollmentStatus(
	client: PoolClient,
	input: {
		courseId: string;
		userId: string;
		from: EnrollmentStatus[];
		to: EnrollmentStatus;
	},
): Promise<string | null> {
	const { rows } = await client.query<{ id: string }>(
		`update catalog.enrollment set status = $4
		 where course_id = $1 and user_id = $2 and status = any ($3::catalog.enrollment_status[])
		 returning id`,
		[input.courseId, input.userId, input.from, input.to],
	);
	return rows[0]?.id ?? null;
}

/** Completed and total lessons of a course for one student. */
export async function lessonProgress(
	courseId: string,
	userId: string,
): Promise<{ done: number; total: number }> {
	const { rows } = await pool.query<{ total: string; done: string }>(
		`select count(*) as total, count(p.lesson_id) as done
		 from catalog.lesson l
		 left join catalog.lesson_progress p on p.lesson_id = l.id and p.user_id = $2
		 where l.course_id = $1`,
		[courseId, userId],
	);
	return {
		total: Number(rows[0]?.total ?? 0),
		done: Number(rows[0]?.done ?? 0),
	};
}

export async function completedLessonIds(
	courseId: string,
	userId: string,
): Promise<string[]> {
	const { rows } = await pool.query<{ lesson_id: string }>(
		`select p.lesson_id from catalog.lesson_progress p
		 join catalog.lesson l on l.id = p.lesson_id
		 where l.course_id = $1 and p.user_id = $2`,
		[courseId, userId],
	);
	return rows.map((r) => r.lesson_id);
}

/**
 * The single completion rule: every lesson done and a passing attempt on each
 * required published exam (ADR-0033).
 */
export function courseRequirementsMet(progress: {
	totalLessons: number;
	completedLessons: number;
	pendingRequiredExams: number;
}): boolean {
	return (
		progress.totalLessons > 0 &&
		progress.completedLessons === progress.totalLessons &&
		progress.pendingRequiredExams === 0
	);
}

/**
 * Checks the completion rule for one student inside the caller's transaction and,
 * the first time it holds, completes the enrollment and emits `course.completed`.
 * Called after a lesson is completed and after a required exam is passed.
 */
export async function completeCourseIfDone(
	client: PoolClient,
	courseId: string,
	userId: string,
): Promise<CompletionResult> {
	const counts = await client.query<{
		total: string;
		done: string;
		pending_exams: string;
	}>(
		`select count(*) as total,
		        count(p.lesson_id) as done,
		        (select count(*) from exams.exam e
		          where e.course_id = $1 and e.required and e.published
		            and not exists (select 1 from exams.attempt a
		                             where a.exam_id = e.id and a.user_id = $2 and a.passed)) as pending_exams
		 from catalog.lesson l
		 left join catalog.lesson_progress p on p.lesson_id = l.id and p.user_id = $2
		 where l.course_id = $1`,
		[courseId, userId],
	);
	const courseCompleted = courseRequirementsMet({
		totalLessons: Number(counts.rows[0]?.total ?? 0),
		completedLessons: Number(counts.rows[0]?.done ?? 0),
		pendingRequiredExams: Number(counts.rows[0]?.pending_exams ?? 0),
	});

	let justCompleted = false;
	if (courseCompleted) {
		const marked = await client.query<{ id: string }>(
			`update catalog.enrollment set completed_at = now()
			 where course_id = $1 and user_id = $2 and completed_at is null and status = 'active'
			 returning id`,
			[courseId, userId],
		);
		const enrollment = marked.rows[0];
		justCompleted = !!enrollment;
		if (enrollment) {
			await emitEvent(
				client,
				"course.completed",
				{ enrollmentId: enrollment.id, courseId, userId },
				`course.completed:${enrollment.id}`,
			);
		}
	}
	return { courseCompleted, justCompleted };
}

export async function completeLesson(
	courseId: string,
	lessonId: string,
	userId: string,
): Promise<CompletionResult> {
	return inTransaction(async (client) => {
		await client.query(
			`insert into catalog.lesson_progress (lesson_id, user_id)
			 select l.id, $3 from catalog.lesson l where l.id = $2 and l.course_id = $1
			 on conflict do nothing`,
			[courseId, lessonId, userId],
		);
		return completeCourseIfDone(client, courseId, userId);
	});
}

// -------------------------------------------------------------- content editing

export async function updateCourseDetails(
	organizationId: string,
	courseId: string,
	details: {
		name: string;
		shortDescription: string | null;
		longDescription: string | null;
	},
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update catalog.course
		 set name = $3, short_description = $4, long_description = $5, updated_at = now()
		 where organization_id = $1 and id = $2`,
		[
			organizationId,
			courseId,
			details.name,
			details.shortDescription,
			details.longDescription,
		],
	);
	return (rowCount ?? 0) > 0;
}

export async function updateModule(
	courseId: string,
	moduleId: string,
	values: { title: string; description: string | null },
) {
	await pool.query(
		`update catalog.module set title = $3, description = $4
		 where course_id = $1 and id = $2`,
		[courseId, moduleId, values.title, values.description],
	);
}

/** Deleting a module deletes its lessons and their progress (cascade). */
export async function deleteModule(courseId: string, moduleId: string) {
	await pool.query(
		`delete from catalog.module where course_id = $1 and id = $2`,
		[courseId, moduleId],
	);
}

export async function updateLesson(
	courseId: string,
	lessonId: string,
	values: { title: string; description: string | null },
) {
	await pool.query(
		`update catalog.lesson set title = $3, description = $4
		 where course_id = $1 and id = $2`,
		[courseId, lessonId, values.title, values.description],
	);
}

export async function deleteLesson(courseId: string, lessonId: string) {
	await pool.query(
		`delete from catalog.lesson where course_id = $1 and id = $2`,
		[courseId, lessonId],
	);
}

/**
 * Swaps a module (within its course) or a lesson (within its module) with its
 * neighbour and rewrites every position of that list in one transaction.
 */
export async function moveItem(
	courseId: string,
	kind: "module" | "lesson",
	id: string,
	direction: "up" | "down",
) {
	await inTransaction(async (client) => {
		// Table and columns come from this fixed choice, never from the caller.
		const table = kind === "module" ? "catalog.module" : "catalog.lesson";
		const scope = kind === "module" ? "course_id" : "module_id";
		const parent = await client.query<{ scope_id: string }>(
			`select ${scope} as scope_id from ${table} where id = $1 and course_id = $2`,
			[id, courseId],
		);
		const scopeId = parent.rows[0]?.scope_id;
		if (!scopeId) return;

		const siblings = await client.query<{ id: string }>(
			`select id from ${table} where ${scope} = $1 order by position, id for update`,
			[scopeId],
		);
		const ids = siblings.rows.map((r) => r.id);
		const from = ids.indexOf(id);
		const to = direction === "up" ? from - 1 : from + 1;
		if (to < 0 || to >= ids.length) return;
		[ids[from], ids[to]] = [ids[to] as string, ids[from] as string];

		await client.query(
			`update ${table} t set position = o.pos
			 from unnest($1::uuid[]) with ordinality as o(id, pos)
			 where t.id = o.id`,
			[ids],
		);
	});
}
