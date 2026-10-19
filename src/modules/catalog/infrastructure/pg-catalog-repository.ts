import type { Pool, PoolClient } from "pg";
import { slugify } from "../../../shared/text/slugify.ts";
import type {
	CatalogRepository,
	CourseLookup,
} from "../application/catalog-repository.ts";
import { uniqueSlug } from "../domain/course-from-import.ts";
import {
	type CourseOutline,
	type CourseStatus,
	type CourseSummary,
	type Lesson,
	type MediaRef,
	type Module,
	SlugTakenError,
} from "../domain/types.ts";

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
	cover_images, promo_video, requirements, learning_goals, target_students, status`;

function toSummary(row: CourseRow): CourseSummary {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		shortDescription: row.short_description,
		status: row.status,
	};
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
	const e = error as { code?: string; constraint?: string };
	return e.code === "23505" && e.constraint === constraint;
}

export function createPgCatalogRepository(pool: Pool): CatalogRepository {
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

	async function inTransaction<T>(run: (client: PoolClient) => Promise<T>) {
		const client = await pool.connect();
		try {
			await client.query("begin");
			const result = await run(client);
			await client.query("commit");
			return result;
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	return {
		async createCourse(organizationId, course) {
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
		},

		async listCourses(organizationId, { publishedOnly }) {
			const { rows } = await pool.query<CourseRow>(
				`select ${COURSE_COLUMNS} from catalog.course
				 where organization_id = $1 and ($2::boolean = false or status = 'published')
				 order by created_at desc`,
				[organizationId, publishedOnly],
			);
			return rows.map(toSummary);
		},

		async findBySlug(organizationId, slug): Promise<CourseLookup | null> {
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
			return renamed.rows[0]
				? { kind: "moved", slug: renamed.rows[0].slug }
				: null;
		},

		async findById(organizationId, id) {
			const { rows } = await pool.query<CourseRow>(
				`select ${COURSE_COLUMNS} from catalog.course
				 where organization_id = $1 and id = $2`,
				[organizationId, id],
			);
			return rows[0] ? outlineOf(rows[0]) : null;
		},

		async setStatus(organizationId, courseId, status) {
			const { rowCount } = await pool.query(
				`update catalog.course set status = $3, updated_at = now()
				 where organization_id = $1 and id = $2`,
				[organizationId, courseId, status],
			);
			return (rowCount ?? 0) > 0;
		},

		async renameSlug(organizationId, courseId, newSlug) {
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
		},

		async addModule(courseId, title) {
			await pool.query(
				`insert into catalog.module (course_id, title, position)
				 values ($1, $2, coalesce((select max(position) from catalog.module where course_id = $1), 0) + 1)`,
				[courseId, title],
			);
		},

		async addLesson(moduleId, { title, description }) {
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
		},

		async enroll({ courseId, userId, source, paymentId }) {
			const { rowCount } = await pool.query(
				`insert into catalog.enrollment (course_id, user_id, source, payment_id)
				 values ($1, $2, $3, $4) on conflict do nothing`,
				[courseId, userId, source, paymentId ?? null],
			);
			return (rowCount ?? 0) > 0;
		},

		async findEnrollment(courseId, userId) {
			const { rows } = await pool.query<{ completed_at: Date | null }>(
				`select completed_at from catalog.enrollment where course_id = $1 and user_id = $2`,
				[courseId, userId],
			);
			return rows[0] ? { completedAt: rows[0].completed_at } : null;
		},

		async completedLessonIds(courseId, userId) {
			const { rows } = await pool.query<{ lesson_id: string }>(
				`select p.lesson_id from catalog.lesson_progress p
				 join catalog.lesson l on l.id = p.lesson_id
				 where l.course_id = $1 and p.user_id = $2`,
				[courseId, userId],
			);
			return rows.map((r) => r.lesson_id);
		},

		async completeLesson(courseId, lessonId, userId) {
			return inTransaction(async (client) => {
				await client.query(
					`insert into catalog.lesson_progress (lesson_id, user_id)
					 select l.id, $3 from catalog.lesson l where l.id = $2 and l.course_id = $1
					 on conflict do nothing`,
					[courseId, lessonId, userId],
				);
				const counts = await client.query<{ total: string; done: string }>(
					`select count(*) as total,
					        count(p.lesson_id) as done
					 from catalog.lesson l
					 left join catalog.lesson_progress p on p.lesson_id = l.id and p.user_id = $2
					 where l.course_id = $1`,
					[courseId, userId],
				);
				const total = Number(counts.rows[0]?.total ?? 0);
				const done = Number(counts.rows[0]?.done ?? 0);
				const courseCompleted = total > 0 && done === total;

				let justCompleted = false;
				if (courseCompleted) {
					const marked = await client.query(
						`update catalog.enrollment set completed_at = now()
						 where course_id = $1 and user_id = $2 and completed_at is null`,
						[courseId, userId],
					);
					justCompleted = (marked.rowCount ?? 0) > 0;
				}
				return { courseCompleted, justCompleted };
			});
		},
	};
}
