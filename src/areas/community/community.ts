import type { PoolClient } from "pg";
import { pool } from "../../server/db.server.ts";
import {
	authorKindOf,
	type Comment,
	type FeaturedReview,
	type PendingComment,
	type ReportedComment,
	type Review,
	type ReviewSummary,
} from "./types.ts";

// Posting limits per person; comments have no length limit besides this hard cap.
const COMMENTS_PER_MINUTE = 5;
const COMMENTS_PER_DAY = 60;
export const COMMENT_MAX_LENGTH = 10_000;

const REVIEW_COLUMNS = `r.id, r.user_id, u.name as author_name, r.rating, r.body, r.hidden,
	r.reply_body, r.reply_at, r.created_at`;

type ReviewRow = {
	id: string;
	user_id: string;
	author_name: string;
	rating: number;
	body: string;
	hidden: boolean;
	reply_body: string | null;
	reply_at: Date | null;
	created_at: Date;
};

const toReview = (row: ReviewRow): Review => ({
	id: row.id,
	userId: row.user_id,
	authorName: row.author_name,
	rating: row.rating,
	body: row.body,
	hidden: row.hidden,
	reply:
		row.reply_body && row.reply_at
			? { body: row.reply_body, createdAt: row.reply_at.toISOString() }
			: null,
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
		`select ${REVIEW_COLUMNS}
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
		`select ${REVIEW_COLUMNS}
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
		`select ${REVIEW_COLUMNS}, r.course_id
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

/** Moderation hide/unhide. A review of a student without active access stays hidden. */
export async function setReviewHidden(
	organizationId: string,
	reviewId: string,
	hidden: boolean,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.review r
		 set hidden = $3, hidden_reason = case when $3 then 'moderation' end, updated_at = now()
		 where r.organization_id = $1 and r.id = $2
		   and ($3 or exists (
		     select 1 from catalog.enrollment e
		     where e.course_id = r.course_id and e.user_id = r.user_id and e.status = 'active'))`,
		[organizationId, reviewId, hidden],
	);
	return (rowCount ?? 0) > 0;
}

/** One public reply per review; saving again edits it. */
export async function saveReviewReply(input: {
	organizationId: string;
	reviewId: string;
	userId: string;
	body: string;
}): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.review
		 set reply_body = $4, reply_user_id = $3, reply_at = now()
		 where organization_id = $1 and id = $2`,
		[input.organizationId, input.reviewId, input.userId, input.body],
	);
	return (rowCount ?? 0) > 0;
}

export async function removeReviewReply(
	organizationId: string,
	reviewId: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.review
		 set reply_body = null, reply_user_id = null, reply_at = null
		 where organization_id = $1 and id = $2`,
		[organizationId, reviewId],
	);
	return (rowCount ?? 0) > 0;
}

/** Full refund: the review stops being public. Runs in the refund's transaction. */
export async function hideReviewForRefund(
	client: PoolClient,
	courseId: string,
	userId: string,
) {
	await client.query(
		`update community.review set hidden = true, hidden_reason = 'refund', updated_at = now()
		 where course_id = $1 and user_id = $2 and not hidden`,
		[courseId, userId],
	);
}

/** Access is back: only reviews hidden by the refund return, never moderation hides. */
export async function restoreReviewAfterRefund(
	client: PoolClient,
	courseId: string,
	userId: string,
) {
	await client.query(
		`update community.review set hidden = false, hidden_reason = null, updated_at = now()
		 where course_id = $1 and user_id = $2 and hidden_reason = 'refund'`,
		[courseId, userId],
	);
}

// ------------------------------------------------------------------- comments

export async function isMuted(
	organizationId: string,
	userId: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		"select 1 from community.comment_mute where organization_id = $1 and user_id = $2",
		[organizationId, userId],
	);
	return (rowCount ?? 0) > 0;
}

export async function setMuted(
	organizationId: string,
	userId: string,
	muted: boolean,
) {
	if (muted) {
		await pool.query(
			`insert into community.comment_mute (organization_id, user_id) values ($1, $2)
			 on conflict do nothing`,
			[organizationId, userId],
		);
	} else {
		await pool.query(
			"delete from community.comment_mute where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
	}
}

/** Posts a comment unless the person is muted or posts too fast. Replies send no email. */
export async function addComment(input: {
	organizationId: string;
	courseId: string;
	lessonId: string;
	userId: string;
	parentId: string | null;
	body: string;
	/** Staff and tutors answer; a student's follow-up reopens the thread. */
	fromTeam: boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
	if (await isMuted(input.organizationId, input.userId)) {
		return {
			ok: false,
			message:
				"El equipo de la academia te silenció en los comentarios. Tus reseñas no se ven afectadas.",
		};
	}
	const { rows } = await pool.query<{ last_minute: string; last_day: string }>(
		`select count(*) filter (where created_at > now() - interval '1 minute') as last_minute,
		        count(*) as last_day
		 from community.comment
		 where user_id = $1 and created_at > now() - interval '1 day'`,
		[input.userId],
	);
	if (Number(rows[0]?.last_minute) >= COMMENTS_PER_MINUTE) {
		return {
			ok: false,
			message:
				"Estás comentando muy rápido. Esperá un minuto e intentá de nuevo.",
		};
	}
	if (Number(rows[0]?.last_day) >= COMMENTS_PER_DAY) {
		return {
			ok: false,
			message: "Llegaste al límite de comentarios de hoy. Probá mañana.",
		};
	}

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
	if (input.parentId && !input.fromTeam) {
		await pool.query(
			"update community.comment set answered = false where id = $1",
			[input.parentId],
		);
	}
	return { ok: true };
}

export async function listComments(
	lessonId: string,
	{
		includeHidden,
		viewerId,
		seeReports,
	}: { includeHidden: boolean; viewerId: string | null; seeReports: boolean },
): Promise<Comment[]> {
	const { rows } = await pool.query<{
		id: string;
		user_id: string;
		author_name: string;
		role: string | null;
		parent_id: string | null;
		body: string;
		hidden: boolean;
		deleted_at: Date | null;
		answered: boolean;
		pinned: boolean;
		reports: string;
		reported_by_me: boolean;
		created_at: Date;
	}>(
		`select c.id, c.user_id, u.name as author_name, m.role, c.parent_id, c.body, c.hidden,
		        c.deleted_at, c.answered, c.pinned, c.created_at,
		        (select count(*) from community.comment_report x where x.comment_id = c.id) as reports,
		        exists (select 1 from community.comment_report x
		                where x.comment_id = c.id and x.user_id = $3) as reported_by_me
		 from community.comment c
		 join auth."user" u on u.id = c.user_id
		 left join auth.member m on m."userId" = c.user_id and m."organizationId" = c.organization_id
		 where c.lesson_id = $1 and ($2::boolean or not c.hidden)
		 order by c.pinned desc, c.created_at`,
		[lessonId, includeHidden, viewerId],
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
			body: row.deleted_at ? "" : row.body,
			hidden: row.hidden,
			deleted: row.deleted_at !== null,
			answered: row.answered,
			pinned: row.pinned,
			reports: seeReports ? Number(row.reports) : 0,
			reportedByMe: row.reported_by_me,
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
	userId: string;
	deleted: boolean;
} | null> {
	const { rows } = await pool.query<{
		course_id: string;
		lesson_id: string;
		parent_id: string | null;
		user_id: string;
		deleted_at: Date | null;
	}>(
		`select course_id, lesson_id, parent_id, user_id, deleted_at from community.comment
		 where organization_id = $1 and id = $2`,
		[organizationId, commentId],
	);
	const row = rows[0];
	return row
		? {
				courseId: row.course_id,
				lessonId: row.lesson_id,
				parentId: row.parent_id,
				userId: row.user_id,
				deleted: row.deleted_at !== null,
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

/** Marks a top-level comment as answered, or pins it to the top of the thread list. */
export async function setCommentFlag(
	organizationId: string,
	commentId: string,
	flag: "answered" | "pinned",
	value: boolean,
): Promise<boolean> {
	const column = flag === "answered" ? "answered" : "pinned";
	const { rowCount } = await pool.query(
		`update community.comment set ${column} = $3
		 where organization_id = $1 and id = $2 and parent_id is null`,
		[organizationId, commentId, value],
	);
	return (rowCount ?? 0) > 0;
}

/** One report per person and comment. False when the person had already reported it. */
export async function reportComment(
	commentId: string,
	userId: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`insert into community.comment_report (comment_id, user_id) values ($1, $2)
		 on conflict do nothing`,
		[commentId, userId],
	);
	return (rowCount ?? 0) > 0;
}

export async function dismissReports(commentId: string) {
	await pool.query(
		"delete from community.comment_report where comment_id = $1",
		[commentId],
	);
}

/** Moderation delete: the row stays as a tombstone so replies keep their place. */
export async function deleteComment(
	organizationId: string,
	commentId: string,
): Promise<boolean> {
	const { rowCount } = await pool.query(
		`update community.comment set deleted_at = now(), pinned = false
		 where organization_id = $1 and id = $2 and deleted_at is null`,
		[organizationId, commentId],
	);
	await dismissReports(commentId);
	return (rowCount ?? 0) > 0;
}

/** Comments with open reports; `courseIds` null means every course of the academy. */
export async function reportedComments(
	organizationId: string,
	courseIds: string[] | null,
): Promise<ReportedComment[]> {
	const { rows } = await pool.query<{
		id: string;
		course_id: string;
		lesson_id: string;
		user_id: string;
		author_name: string;
		muted: boolean;
		body: string;
		hidden: boolean;
		reports: string;
		created_at: Date;
	}>(
		`select c.id, c.course_id, c.lesson_id, c.user_id, u.name as author_name, c.body, c.hidden,
		        c.created_at, count(x.user_id) as reports,
		        exists (select 1 from community.comment_mute mu
		                where mu.organization_id = c.organization_id and mu.user_id = c.user_id) as muted
		 from community.comment c
		 join community.comment_report x on x.comment_id = c.id
		 join auth."user" u on u.id = c.user_id
		 where c.organization_id = $1 and c.deleted_at is null
		   and ($2::uuid[] is null or c.course_id = any ($2::uuid[]))
		 group by c.id, u.name
		 order by count(x.user_id) desc, c.created_at limit 100`,
		[organizationId, courseIds],
	);
	return rows.map(
		(row): ReportedComment => ({
			id: row.id,
			courseId: row.course_id,
			lessonId: row.lesson_id,
			authorId: row.user_id,
			authorName: row.author_name,
			authorMuted: row.muted,
			body: row.body,
			hidden: row.hidden,
			reports: Number(row.reports),
			createdAt: row.created_at.toISOString(),
		}),
	);
}

/**
 * Threads on these courses that need an answer: not marked answered and whose
 * latest visible comment (the top-level one or the last reply) is not from
 * staff or a tutor.
 */
export async function commentsAwaitingReply(
	organizationId: string,
	courseIds: string[],
): Promise<PendingComment[]> {
	if (courseIds.length === 0) return [];
	const { rows } = await pool.query<{
		id: string;
		thread_id: string;
		course_id: string;
		lesson_id: string;
		author_name: string;
		body: string;
		created_at: Date;
	}>(
		`select l.id, l.thread_id, l.course_id, l.lesson_id, u.name as author_name, l.body, l.created_at
		 from (
		   select distinct on (thread_id) *
		   from (
		     select c.*, coalesce(c.parent_id, c.id) as thread_id
		     from community.comment c
		     where c.organization_id = $1 and c.course_id = any ($2::uuid[])
		       and not c.hidden and c.deleted_at is null
		   ) t
		   order by thread_id, created_at desc
		 ) l
		 join community.comment root on root.id = l.thread_id
		 join auth."user" u on u.id = l.user_id
		 where not root.answered and not root.hidden and root.deleted_at is null
		   and not exists (
		     select 1 from auth.member m
		     where m."userId" = l.user_id and m."organizationId" = $1
		       and (m.role like '%owner%' or m.role like '%admin%' or m.role like '%tutor%'))
		 order by l.created_at limit 100`,
		[organizationId, courseIds],
	);
	return rows.map(
		(row): PendingComment => ({
			id: row.id,
			threadId: row.thread_id,
			courseId: row.course_id,
			lessonId: row.lesson_id,
			authorName: row.author_name,
			body: row.body,
			createdAt: row.created_at.toISOString(),
		}),
	);
}
