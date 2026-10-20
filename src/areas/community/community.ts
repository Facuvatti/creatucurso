import { pool } from "../../server/db.server.ts";
import {
	authorKindOf,
	type Comment,
	type FeaturedReview,
	type PendingComment,
	type Review,
	type ReviewSummary,
} from "./types.ts";

type ReviewRow = {
	id: string;
	user_id: string;
	author_name: string;
	rating: number;
	body: string;
	hidden: boolean;
	created_at: Date;
};

const toReview = (row: ReviewRow): Review => ({
	id: row.id,
	userId: row.user_id,
	authorName: row.author_name,
	rating: row.rating,
	body: row.body,
	hidden: row.hidden,
	createdAt: row.created_at.toISOString(),
});

// -------------------------------------------------------------------- reviews

/** One review per person and course: a second call replaces the first. */
export async function saveReview(input: {
	organizationId: string;
	courseId: string;
	userId: string;
	rating: number;
	body: string;
}) {
	await pool.query(
		`insert into community.review (organization_id, course_id, user_id, rating, body)
		 values ($1, $2, $3, $4, $5)
		 on conflict (course_id, user_id)
		 do update set rating = excluded.rating, body = excluded.body, updated_at = now()`,
		[
			input.organizationId,
			input.courseId,
			input.userId,
			input.rating,
			input.body,
		],
	);
}

export async function listReviews(
	courseId: string,
	{ includeHidden, limit }: { includeHidden: boolean; limit: number },
): Promise<Review[]> {
	const { rows } = await pool.query<ReviewRow>(
		`select r.id, r.user_id, u.name as author_name, r.rating, r.body, r.hidden, r.created_at
		 from community.review r join auth."user" u on u.id = r.user_id
		 where r.course_id = $1 and ($2::boolean or not r.hidden)
		 order by r.created_at desc limit $3`,
		[courseId, includeHidden, limit],
	);
	return rows.map(toReview);
}

export async function findReviewOf(
	courseId: string,
	userId: string,
): Promise<Review | null> {
	const { rows } = await pool.query<ReviewRow>(
		`select r.id, r.user_id, u.name as author_name, r.rating, r.body, r.hidden, r.created_at
		 from community.review r join auth."user" u on u.id = r.user_id
		 where r.course_id = $1 and r.user_id = $2`,
		[courseId, userId],
	);
	return rows[0] ? toReview(rows[0]) : null;
}

export async function reviewSummaries(
	courseIds: string[],
): Promise<Map<string, ReviewSummary>> {
	const result = new Map<string, ReviewSummary>();
	if (courseIds.length === 0) return result;
	const { rows } = await pool.query<{
		course_id: string;
		count: string;
		average: string | null;
	}>(
		`select course_id, count(*) as count, avg(rating) as average
		 from community.review
		 where course_id = any ($1::uuid[]) and not hidden
		 group by course_id`,
		[courseIds],
	);
	for (const row of rows) {
		result.set(row.course_id, {
			count: Number(row.count),
			average:
				row.average === null ? null : Math.round(Number(row.average) * 10) / 10,
		});
	}
	return result;
}

/** Best recent reviews among these (published) courses. */
export async function featuredReviews(
	organizationId: string,
	courseIds: string[],
	limit: number,
): Promise<FeaturedReview[]> {
	if (courseIds.length === 0) return [];
	const { rows } = await pool.query<ReviewRow & { course_id: string }>(
		`select r.id, r.user_id, u.name as author_name, r.rating, r.body, r.hidden, r.created_at,
		        r.course_id
		 from community.review r
		 join auth."user" u on u.id = r.user_id
		 where r.organization_id = $1 and r.course_id = any ($2::uuid[])
		   and not r.hidden and r.rating >= 4 and length(r.body) > 0
		 order by r.created_at desc limit $3`,
		[organizationId, courseIds, limit],
	);
	return rows.map(
		(row): FeaturedReview => ({ ...toReview(row), courseId: row.course_id }),
	);
}

export async function setReviewHidden(
	organizationId: string,
	reviewId: string,
	hidden: boolean,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.review set hidden = $3, updated_at = now()
		 where organization_id = $1 and id = $2`,
		[organizationId, reviewId, hidden],
	);
	return (rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------- comments

export async function addComment(input: {
	organizationId: string;
	courseId: string;
	lessonId: string;
	userId: string;
	parentId: string | null;
	body: string;
}) {
	await pool.query(
		`insert into community.comment (organization_id, course_id, lesson_id, user_id, parent_id, body)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			input.organizationId,
			input.courseId,
			input.lessonId,
			input.userId,
			input.parentId,
			input.body,
		],
	);
}

export async function listComments(
	lessonId: string,
	{ includeHidden }: { includeHidden: boolean },
): Promise<Comment[]> {
	const { rows } = await pool.query<{
		id: string;
		user_id: string;
		author_name: string;
		role: string | null;
		parent_id: string | null;
		body: string;
		hidden: boolean;
		created_at: Date;
	}>(
		`select c.id, c.user_id, u.name as author_name, m.role, c.parent_id, c.body, c.hidden, c.created_at
		 from community.comment c
		 join auth."user" u on u.id = c.user_id
		 left join auth.member m on m."userId" = c.user_id and m."organizationId" = c.organization_id
		 where c.lesson_id = $1 and ($2::boolean or not c.hidden)
		 order by c.created_at`,
		[lessonId, includeHidden],
	);
	return rows.map(
		(row): Comment => ({
			id: row.id,
			userId: row.user_id,
			authorName: row.author_name,
			authorKind: authorKindOf(
				(row.role ?? "").split(",").map((r) => r.trim()),
			),
			parentId: row.parent_id,
			body: row.body,
			hidden: row.hidden,
			createdAt: row.created_at.toISOString(),
		}),
	);
}

/** Where a comment lives, to check that a reply belongs to the same lesson. */
export async function findCommentPlace(
	organizationId: string,
	commentId: string,
): Promise<{
	courseId: string;
	lessonId: string;
	parentId: string | null;
} | null> {
	const { rows } = await pool.query<{
		course_id: string;
		lesson_id: string;
		parent_id: string | null;
	}>(
		`select course_id, lesson_id, parent_id from community.comment
		 where organization_id = $1 and id = $2`,
		[organizationId, commentId],
	);
	const row = rows[0];
	return row
		? {
				courseId: row.course_id,
				lessonId: row.lesson_id,
				parentId: row.parent_id,
			}
		: null;
}

export async function setCommentHidden(
	organizationId: string,
	commentId: string,
	hidden: boolean,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.comment set hidden = $3 where organization_id = $1 and id = $2`,
		[organizationId, commentId, hidden],
	);
	return (rowCount ?? 0) > 0;
}

/** Top-level comments on these courses that no tutor or staff member has answered. */
export async function commentsAwaitingReply(
	organizationId: string,
	courseIds: string[],
): Promise<PendingComment[]> {
	if (courseIds.length === 0) return [];
	const { rows } = await pool.query<{
		id: string;
		course_id: string;
		lesson_id: string;
		author_name: string;
		body: string;
		created_at: Date;
	}>(
		`select c.id, c.course_id, c.lesson_id, u.name as author_name, c.body, c.created_at
		 from community.comment c
		 join auth."user" u on u.id = c.user_id
		 where c.organization_id = $1 and c.course_id = any ($2::uuid[])
		   and c.parent_id is null and not c.hidden
		   and not exists (
		     select 1 from community.comment r
		     join auth.member m on m."userId" = r.user_id and m."organizationId" = r.organization_id
		     where r.parent_id = c.id and not r.hidden
		       and (m.role like '%owner%' or m.role like '%admin%' or m.role like '%tutor%')
		   )
		 order by c.created_at limit 100`,
		[organizationId, courseIds],
	);
	return rows.map(
		(row): PendingComment => ({
			id: row.id,
			courseId: row.course_id,
			lessonId: row.lesson_id,
			authorName: row.author_name,
			body: row.body,
			createdAt: row.created_at.toISOString(),
		}),
	);
}
