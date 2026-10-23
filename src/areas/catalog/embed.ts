// Lessons with an embedded web app that reports a result (docs/plan-embedded-lessons.md).
//
// Two ways to report: the student's browser (source "client", unverified) and the
// app's own backend with an HMAC signature (source "server", verified). A verified
// result is never replaced by a client one, and `embed_verified_only` makes only
// the verified way complete the lesson.
import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { inTransaction, pool } from "../../server/db.server.ts";
import {
	decryptSecret,
	encryptSecret,
} from "../../shared/crypto/secret-box.ts";
import { completeCourseIfDone } from "./catalog.ts";

export { embedOrigin, validateEmbedUrl } from "./embed-url.ts";

export const SESSION_TTL_HOURS = 2;
export const SIGNATURE_WINDOW_SEC = 300;
export const MAX_REPORT_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 4096;
const SESSIONS_PER_MINUTE = 20;

function secretsKey(): string {
	const key = process.env.SECRETS_ENCRYPTION_KEY;
	if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return key;
}

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

// ----------------------------------------------------------------- the result

export type NormalizedResult = {
	score: number | null;
	maxScore: number | null;
	/** The reported flag; null when absent (then the lesson's passing score decides). */
	passed: boolean | null;
	timeSpentSec: number | null;
	metadata: Record<string, unknown> | null;
};

export type NormalizeOutcome =
	| { ok: true; result: NormalizedResult; passed: boolean }
	| { ok: false; message: string };

/**
 * Validates a reported result by hand. At least one of `score` or `passed` is
 * required. `passed` decides when present; otherwise it is
 * `score / maxScore * 100 >= passingScore`.
 */
export function normalizeResult(
	input: unknown,
	passingScore: number,
): NormalizeOutcome {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, message: "The result must be an object." };
	}
	const raw = input as Record<string, unknown>;
	const has = (key: string) => raw[key] !== undefined && raw[key] !== null;
	const finite = (value: unknown): value is number =>
		typeof value === "number" && Number.isFinite(value);

	if (!has("score") && !has("passed")) {
		return { ok: false, message: "Send at least a score or passed." };
	}

	let score: number | null = null;
	let maxScore: number | null = null;
	if (has("score")) {
		if (!finite(raw.score))
			return { ok: false, message: "score must be a number." };
		maxScore = 100;
		if (has("maxScore")) {
			if (!finite(raw.maxScore) || raw.maxScore <= 0) {
				return { ok: false, message: "maxScore must be a number above 0." };
			}
			maxScore = raw.maxScore;
		}
		if (raw.score < 0 || raw.score > maxScore) {
			return { ok: false, message: "score must be between 0 and maxScore." };
		}
		score = raw.score;
	} else if (has("maxScore")) {
		return { ok: false, message: "maxScore needs a score." };
	}

	let passed: boolean | null = null;
	if (has("passed")) {
		if (typeof raw.passed !== "boolean") {
			return { ok: false, message: "passed must be true or false." };
		}
		passed = raw.passed;
	}

	let timeSpentSec: number | null = null;
	if (has("timeSpentSec")) {
		if (
			!Number.isInteger(raw.timeSpentSec) ||
			(raw.timeSpentSec as number) < 0
		) {
			return {
				ok: false,
				message: "timeSpentSec must be a whole number, 0 or more.",
			};
		}
		timeSpentSec = raw.timeSpentSec as number;
	}

	let metadata: Record<string, unknown> | null = null;
	if (has("metadata")) {
		const value = raw.metadata;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return { ok: false, message: "metadata must be an object." };
		}
		if (Buffer.byteLength(JSON.stringify(value)) > MAX_METADATA_BYTES) {
			return { ok: false, message: "metadata is too large (4 KB at most)." };
		}
		metadata = value as Record<string, unknown>;
	}

	const decided =
		passed ??
		(score !== null && maxScore !== null
			? (score / maxScore) * 100 >= passingScore
			: false);
	return {
		ok: true,
		result: { score, maxScore, passed, timeSpentSec, metadata },
		passed: decided,
	};
}

// ------------------------------------------------------------------ sessions

export type StartSessionResult =
	| { ok: true; token: string; expiresAt: Date }
	| { ok: false; message: string };

/** A session token for the embedded app: 32 random bytes; only its sha256 is stored. */
export async function startSession(
	lessonId: string,
	userId: string,
): Promise<StartSessionResult> {
	const { rows: recent } = await pool.query<{ count: string }>(
		`select count(*) as count from catalog.embed_session
		 where user_id = $1 and created_at > now() - interval '1 minute'`,
		[userId],
	);
	if (Number(recent[0]?.count ?? 0) >= SESSIONS_PER_MINUTE) {
		return {
			ok: false,
			message: "Abriste la clase muchas veces. Esperá un momento.",
		};
	}

	const token = randomBytes(32).toString("base64url");
	const { rows } = await pool.query<{ expires_at: Date }>(
		`insert into catalog.embed_session (token_hash, lesson_id, user_id, expires_at)
		 values ($1, $2, $3, now() + make_interval(hours => $4))
		 returning expires_at`,
		[sha256(token), lessonId, userId, SESSION_TTL_HOURS],
	);
	// Housekeeping: nothing reads a session a day after it expired.
	await pool.query(
		`delete from catalog.embed_session where expires_at < now() - interval '1 day'`,
	);
	return { ok: true, token, expiresAt: rows[0]?.expires_at as Date };
}

export type EmbedSession = {
	lessonId: string;
	courseId: string;
	userId: string;
};

/** The live session behind a token, or null when it is unknown or expired. */
export async function findSession(token: string): Promise<EmbedSession | null> {
	const { rows } = await pool.query<{
		lesson_id: string;
		course_id: string;
		user_id: string;
	}>(
		`select s.lesson_id, l.course_id, s.user_id
		 from catalog.embed_session s
		 join catalog.lesson l on l.id = s.lesson_id
		 where s.token_hash = $1 and s.expires_at > now()`,
		[sha256(token)],
	);
	const row = rows[0];
	return row
		? { lessonId: row.lesson_id, courseId: row.course_id, userId: row.user_id }
		: null;
}

// ------------------------------------------------------------ course secret

export async function hasAppSecret(courseId: string): Promise<boolean> {
	const { rowCount } = await pool.query(
		`select 1 from catalog.course_app_secret where course_id = $1`,
		[courseId],
	);
	return (rowCount ?? 0) > 0;
}

/** Creates the secret of a course or replaces it. The plain text is returned only here. */
export async function rotateAppSecret(courseId: string): Promise<string> {
	const secret = randomBytes(32).toString("base64url");
	await pool.query(
		`insert into catalog.course_app_secret (course_id, secret_encrypted)
		 values ($1, $2)
		 on conflict (course_id)
		 do update set secret_encrypted = excluded.secret_encrypted, rotated_at = now()`,
		[courseId, encryptSecret(secret, secretsKey())],
	);
	return secret;
}

export async function getAppSecret(courseId: string): Promise<string | null> {
	const { rows } = await pool.query<{ secret_encrypted: string }>(
		`select secret_encrypted from catalog.course_app_secret where course_id = $1`,
		[courseId],
	);
	const box = rows[0]?.secret_encrypted;
	return box ? decryptSecret(box, secretsKey()) : null;
}

/**
 * Checks `X-Signature` = hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the
 * course secret, and that `X-Timestamp` (Unix seconds) is within 300 s of now.
 * Returns the timestamp when valid, null otherwise.
 */
export function verifyServerSignature(input: {
	secret: string;
	timestamp: string | null;
	signature: string | null;
	rawBody: string;
	nowMs?: number;
}): number | null {
	const { secret, timestamp, signature, rawBody } = input;
	if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp.trim()))
		return null;
	const ts = Number(timestamp.trim());
	const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
	if (Math.abs(nowSec - ts) > SIGNATURE_WINDOW_SEC) return null;

	const expected = createHmac("sha256", secret)
		.update(`${ts}.${rawBody}`)
		.digest("hex");
	const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
	const wanted = Buffer.from(expected, "utf8");
	if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
		return null;
	}
	return ts;
}

// ------------------------------------------------------------------- storage

export type RecordOutcome =
	| {
			ok: true;
			passed: boolean;
			lessonCompleted: boolean;
			courseCompleted: boolean;
	  }
	| { ok: false; reason: "no-lesson" | "not-enrolled" | "stale" };

/**
 * Stores a result and, when it passes, completes the lesson, all in one
 * transaction. A client result never replaces a verified one; a server result
 * must not be older (`ts`) than the last one stored.
 */
export async function recordResult(input: {
	courseId: string;
	lessonId: string;
	userId: string;
	source: "client" | "server";
	result: NormalizedResult;
	passed: boolean;
	/** Unix seconds of the signed report (server source only). */
	ts?: number;
}): Promise<RecordOutcome> {
	const { courseId, lessonId, userId, source, result } = input;
	const ts = input.ts ?? 0;

	return inTransaction(async (client) => {
		const lesson = await client.query<{ embed_verified_only: boolean }>(
			`select embed_verified_only from catalog.lesson
			 where id = $1 and course_id = $2 and embed_url is not null`,
			[lessonId, courseId],
		);
		if (!lesson.rows[0]) return { ok: false, reason: "no-lesson" };

		const enrolled = await client.query(
			`select 1 from catalog.enrollment
			 where course_id = $1 and user_id = $2 and status = 'active'`,
			[courseId, userId],
		);
		if (enrolled.rowCount === 0) return { ok: false, reason: "not-enrolled" };

		const stored = await client.query(
			`insert into catalog.lesson_result
			   (lesson_id, user_id, score, max_score, passed, time_spent_sec, metadata,
			    source, verified, last_ts)
			 values ($1, $2, $3, $4, $5, $6, $7, $8::text, $8::text = 'server', $9)
			 on conflict (lesson_id, user_id) do update set
			   score = excluded.score, max_score = excluded.max_score,
			   passed = excluded.passed, time_spent_sec = excluded.time_spent_sec,
			   metadata = excluded.metadata, source = excluded.source,
			   verified = excluded.verified, last_ts = excluded.last_ts,
			   updated_at = now()
			 where (excluded.source = 'server' and catalog.lesson_result.last_ts <= excluded.last_ts)
			    or (excluded.source = 'client' and not catalog.lesson_result.verified)`,
			[
				lessonId,
				userId,
				result.score,
				result.maxScore,
				input.passed,
				result.timeSpentSec,
				result.metadata ? JSON.stringify(result.metadata) : null,
				source,
				ts,
			],
		);

		if (stored.rowCount === 0) {
			// Not stored: an older signed report, or a client result after a verified one.
			if (source === "server") return { ok: false, reason: "stale" };
			const kept = await client.query<{ passed: boolean | null }>(
				`select passed from catalog.lesson_result where lesson_id = $1 and user_id = $2`,
				[lessonId, userId],
			);
			const done = await client.query(
				`select 1 from catalog.lesson_progress where lesson_id = $1 and user_id = $2`,
				[lessonId, userId],
			);
			return {
				ok: true,
				passed: kept.rows[0]?.passed ?? false,
				lessonCompleted: (done.rowCount ?? 0) > 0,
				courseCompleted: false,
			};
		}

		const verifiedOnly = lesson.rows[0].embed_verified_only;
		let courseCompleted = false;
		if (input.passed && (!verifiedOnly || source === "server")) {
			await client.query(
				`insert into catalog.lesson_progress (lesson_id, user_id)
				 values ($1, $2) on conflict do nothing`,
				[lessonId, userId],
			);
			courseCompleted = (await completeCourseIfDone(client, courseId, userId))
				.courseCompleted;
		}
		const done = await client.query(
			`select 1 from catalog.lesson_progress where lesson_id = $1 and user_id = $2`,
			[lessonId, userId],
		);
		return {
			ok: true,
			passed: input.passed,
			lessonCompleted: (done.rowCount ?? 0) > 0,
			courseCompleted,
		};
	});
}

export type StudentResult = {
	score: number | null;
	maxScore: number | null;
	passed: boolean | null;
	verified: boolean;
};

export async function getStudentResult(
	lessonId: string,
	userId: string,
): Promise<StudentResult | null> {
	const { rows } = await pool.query<{
		score: number | null;
		max_score: number | null;
		passed: boolean | null;
		verified: boolean;
	}>(
		`select score, max_score, passed, verified from catalog.lesson_result
		 where lesson_id = $1 and user_id = $2`,
		[lessonId, userId],
	);
	const row = rows[0];
	return row
		? {
				score: row.score,
				maxScore: row.max_score,
				passed: row.passed,
				verified: row.verified,
			}
		: null;
}

export type ResultRow = {
	lessonId: string;
	lessonTitle: string;
	userName: string;
	userEmail: string;
	score: number | null;
	maxScore: number | null;
	passed: boolean | null;
	verified: boolean;
	updatedAt: string;
};

/** Every reported result of a course, newest first (for the panel). */
export async function listResults(courseId: string): Promise<ResultRow[]> {
	const { rows } = await pool.query<{
		lesson_id: string;
		title: string;
		name: string;
		email: string;
		score: number | null;
		max_score: number | null;
		passed: boolean | null;
		verified: boolean;
		updated_at: Date;
	}>(
		`select r.lesson_id, l.title, u.name, u.email, r.score, r.max_score, r.passed,
		        r.verified, r.updated_at
		 from catalog.lesson_result r
		 join catalog.lesson l on l.id = r.lesson_id
		 join auth."user" u on u.id = r.user_id
		 where l.course_id = $1
		 order by r.updated_at desc
		 limit 1000`,
		[courseId],
	);
	return rows.map((r) => ({
		lessonId: r.lesson_id,
		lessonTitle: r.title,
		userName: r.name,
		userEmail: r.email,
		score: r.score,
		maxScore: r.max_score,
		passed: r.passed,
		verified: r.verified,
		updatedAt: r.updated_at.toISOString(),
	}));
}

/** The passing score (0..100) of an embedded lesson, or null when it has no embed. */
export async function passingScoreOf(lessonId: string): Promise<number | null> {
	const { rows } = await pool.query<{ embed_passing_score: number }>(
		`select embed_passing_score from catalog.lesson
		 where id = $1 and embed_url is not null`,
		[lessonId],
	);
	return rows[0]?.embed_passing_score ?? null;
}
