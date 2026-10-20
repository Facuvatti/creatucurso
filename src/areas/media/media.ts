// Basic-tier video, upload side: limits, signed tokens, the tus hooks and the
// lesson <-> video relation. Playback lives in playback.ts, encoding in
// src/media/encoder.ts. See docs/adr/0020-media-serving.md.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { inTransaction, pool } from "../../server/db.server.ts";
import type { VideoInfo, VideoStatus } from "./types.ts";

const GB = 1024 ** 3;

/** Every media setting, read in one place. Values are config, not constants. */
export function mediaConfig() {
	return {
		maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 2 * GB),
		maxSeconds: Number(process.env.MEDIA_MAX_SECONDS ?? 3600),
		tenantQuotaBytes: Number(process.env.MEDIA_TENANT_QUOTA_BYTES ?? 50 * GB),
		maxStreams: Number(process.env.MEDIA_MAX_STREAMS ?? 30),
		root: path.resolve(process.env.MEDIA_ROOT ?? "./media-data"),
		/** Where the BROWSER reaches nginx (segments) and tusd (/files/). */
		publicUrl: (
			process.env.MEDIA_PUBLIC_URL ?? "http://media.localhost:8088"
		).replace(/\/$/, ""),
	};
}

export function secret(name: "MEDIA_SECRET" | "MEDIA_HOOK_SECRET"): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required for video.`);
	return value;
}

export function uploadPath(videoId: string): string {
	return path.join(mediaConfig().root, "uploads", videoId);
}

export function hlsDir(videoId: string): string {
	return path.join(mediaConfig().root, "hls", videoId);
}

/** Deletes everything stored on disk for a video (upload, tusd info, HLS). */
export async function removeVideoFiles(videoId: string): Promise<void> {
	const original = uploadPath(videoId);
	await Promise.all([
		rm(original, { force: true }),
		rm(`${original}.info`, { force: true }),
		rm(hlsDir(videoId), { force: true, recursive: true }),
	]);
}

// -------------------------------------------------------------------- tokens

/** payload.base64url "." HMAC-SHA256. Payload always has `e`, expiry in unix seconds. */
export function signToken(payload: Record<string, unknown>): string {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const sig = createHmac("sha256", secret("MEDIA_SECRET"))
		.update(body)
		.digest("base64url");
	return `${body}.${sig}`;
}

export function verifyToken<T extends { e: number; k: string }>(
	token: string,
	kind: T["k"],
): T | null {
	const [body, sig] = token.split(".");
	if (!body || !sig) return null;
	const expected = createHmac("sha256", secret("MEDIA_SECRET"))
		.update(body)
		.digest();
	const given = Buffer.from(sig, "base64url");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return null;
	}
	try {
		const payload = JSON.parse(Buffer.from(body, "base64url").toString());
		if (payload.k !== kind || payload.e <= Date.now() / 1000) return null;
		return payload as T;
	} catch {
		return null;
	}
}

type UploadToken = { k: "up"; v: string; u: string; e: number };

// --------------------------------------------------------- lesson <-> video

type VideoRow = {
	id: string;
	lesson_id: string;
	status: VideoStatus;
	error: string | null;
	duration_seconds: number | null;
	height: number | null;
	renditions: number[];
	original_bytes: string;
};

function toInfo(row: VideoRow): VideoInfo {
	return {
		id: row.id,
		lessonId: row.lesson_id,
		status: row.status,
		error: row.error,
		durationSeconds: row.duration_seconds,
		height: row.height,
		renditions: row.renditions,
		originalBytes: Number(row.original_bytes),
	};
}

const VIDEO_COLUMNS = `v.id, v.lesson_id, v.status, v.error, v.duration_seconds,
	v.height, v.renditions, v.original_bytes`;

/** The videos of a course, by lesson id. */
export async function videosOfCourse(
	courseId: string,
): Promise<Record<string, VideoInfo>> {
	const { rows } = await pool.query<VideoRow>(
		`select ${VIDEO_COLUMNS} from media.video v
		 join catalog.lesson l on l.id = v.lesson_id where l.course_id = $1`,
		[courseId],
	);
	return Object.fromEntries(rows.map((row) => [row.lesson_id, toInfo(row)]));
}

export async function videoOfLesson(
	lessonId: string,
): Promise<VideoInfo | null> {
	const { rows } = await pool.query<VideoRow>(
		`select ${VIDEO_COLUMNS} from media.video v where v.lesson_id = $1`,
		[lessonId],
	);
	return rows[0] ? toInfo(rows[0]) : null;
}

/** The course a lesson belongs to, when it belongs to this academy. */
export async function courseIdOfLesson(
	lessonId: string,
	organizationId: string,
): Promise<string | null> {
	const { rows } = await pool.query<{ course_id: string }>(
		`select l.course_id from catalog.lesson l
		 join catalog.course c on c.id = l.course_id
		 where l.id = $1 and c.organization_id = $2`,
		[lessonId, organizationId],
	);
	return rows[0]?.course_id ?? null;
}

/** Storage used by an academy, counted from the sizes of its (non-failed) videos. */
export async function storageUsed(organizationId: string): Promise<number> {
	const { rows } = await pool.query<{ total: string }>(
		`select coalesce(sum(original_bytes), 0) as total from media.video
		 where organization_id = $1 and status <> 'failed'`,
		[organizationId],
	);
	return Number(rows[0]?.total ?? 0);
}

/**
 * Registers the video that is about to be uploaded to a lesson and returns the
 * token the browser sends to tusd. The caller already checked that this person
 * may manage the lesson. A half-sent upload of the same size is resumed;
 * any other previous video of the lesson is replaced.
 */
export async function prepareUpload(input: {
	organizationId: string;
	userId: string;
	lessonId: string;
	size: number;
}): Promise<
	{ ok: true; videoId: string; token: string } | { ok: false; message: string }
> {
	const config = mediaConfig();
	const { organizationId, userId, lessonId, size } = input;
	if (!Number.isSafeInteger(size) || size <= 0) {
		return { ok: false, message: "El archivo está vacío." };
	}
	if (size > config.maxBytes) {
		return {
			ok: false,
			message: `El archivo supera el máximo de ${Math.round(config.maxBytes / GB)} GB.`,
		};
	}

	const result = await inTransaction(async (client) => {
		await client.query("select pg_advisory_xact_lock(hashtext($1))", [
			`media-quota:${organizationId}`,
		]);
		const { rows } = await client.query<{
			id: string;
			status: VideoStatus;
			original_bytes: string;
		}>(
			"select id, status, original_bytes from media.video where lesson_id = $1 for update",
			[lessonId],
		);
		const previous = rows[0];
		if (previous?.status === "encoding" || previous?.status === "uploaded") {
			return {
				ok: false as const,
				message: "Este video se está procesando. Esperá a que termine.",
			};
		}
		if (
			previous?.status === "uploading" &&
			Number(previous.original_bytes) === size
		) {
			return { ok: true as const, videoId: previous.id, stale: null };
		}

		const { rows: used } = await client.query<{ total: string }>(
			`select coalesce(sum(original_bytes), 0) as total from media.video
			 where organization_id = $1 and status <> 'failed' and id is distinct from $2`,
			[organizationId, previous?.id ?? null],
		);
		if (Number(used[0]?.total ?? 0) + size > config.tenantQuotaBytes) {
			return {
				ok: false as const,
				message: "Tu academia alcanzó el límite de almacenamiento de video.",
			};
		}

		if (previous) {
			await client.query("delete from media.video where id = $1", [
				previous.id,
			]);
		}
		const videoId = randomUUID();
		await client.query(
			`insert into media.video (id, organization_id, lesson_id, uploaded_by, original_path, original_bytes)
			 values ($1, $2, $3, $4, $5, $6)`,
			[videoId, organizationId, lessonId, userId, uploadPath(videoId), size],
		);
		return { ok: true as const, videoId, stale: previous?.id ?? null };
	});

	if (!result.ok) return result;
	if (result.stale) await removeVideoFiles(result.stale);
	const token = signToken({
		k: "up",
		v: result.videoId,
		u: userId,
		e: Math.floor(Date.now() / 1000) + 6 * 3600,
	} satisfies UploadToken);
	return { ok: true, videoId: result.videoId, token };
}

/** Removes a lesson's video (not while it is being encoded). */
export async function removeVideo(lessonId: string): Promise<boolean> {
	const { rows } = await pool.query<{ id: string }>(
		`delete from media.video where lesson_id = $1 and status <> 'encoding' returning id`,
		[lessonId],
	);
	if (!rows[0]) return false;
	await removeVideoFiles(rows[0].id);
	return true;
}

// ------------------------------------------------------------------ tus hooks

type TusHookBody = {
	Type?: string;
	Event?: {
		Upload?: {
			ID?: string;
			Size?: number;
			MetaData?: Record<string, string>;
		};
		HTTPRequest?: { Header?: Record<string, string[]> };
	};
};

function reject(status: number, message: string) {
	return {
		RejectUpload: true,
		HTTPResponse: {
			StatusCode: status,
			Body: message,
			Header: { "Content-Type": "text/plain; charset=utf-8" },
		},
	};
}

/**
 * Answers the HTTP hooks of tusd. pre-create authorizes the upload with the
 * token that prepareUpload issued and names the file after the video id;
 * post-finish queues the video for the encoder.
 */
export async function handleTusHook(body: TusHookBody): Promise<object> {
	const upload = body.Event?.Upload;
	if (body.Type === "pre-create") {
		const headers = body.Event?.HTTPRequest?.Header ?? {};
		const authorization = Object.entries(headers).find(
			([name]) => name.toLowerCase() === "authorization",
		)?.[1]?.[0];
		const token = authorization?.replace(/^Bearer /, "") ?? "";
		const claims = verifyToken<UploadToken>(token, "up");
		const videoId = upload?.MetaData?.videoId;
		if (!claims || !videoId || claims.v !== videoId) {
			return reject(403, "No tenés permiso para subir este video.");
		}
		const { rows } = await pool.query(
			`select 1 from media.video
			 where id = $1 and status = 'uploading' and original_bytes = $2`,
			[videoId, upload?.Size ?? 0],
		);
		if (!rows[0]) {
			return reject(400, "La subida ya no es válida. Volvé a intentarlo.");
		}
		// A new upload for the same video starts clean (a fresh start after a lost resume).
		await Promise.all([
			rm(uploadPath(videoId), { force: true }),
			rm(`${uploadPath(videoId)}.info`, { force: true }),
		]);
		return { ChangeFileInfo: { ID: videoId } };
	}

	if (body.Type === "post-finish" && upload?.ID) {
		await pool.query(
			`update media.video set status = 'uploaded', updated_at = now()
			 where id = $1 and status = 'uploading'`,
			[upload.ID],
		);
	}
	return {};
}

export function hookSecretMatches(given: string | null): boolean {
	const expected = Buffer.from(secret("MEDIA_HOOK_SECRET"));
	const actual = Buffer.from(given ?? "");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
