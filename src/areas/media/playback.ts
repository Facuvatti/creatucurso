// Basic-tier video, playback side: admission (stream cap), signed tokens and
// segment URLs, the AES key and the per-session playlists.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inTransaction, pool } from "../../server/db.server.ts";
import { decryptSecret } from "../../shared/crypto/secret-box.ts";
import { findEnrollment } from "../catalog/catalog.ts";
import {
	hlsDir,
	mediaConfig,
	secret,
	signToken,
	verifyToken,
} from "./media.ts";

/** A playback counts against the cap while its last heartbeat is this recent. */
const LIVE_SECONDS = 90;
export const HEARTBEAT_MS = 30_000;
const TOKEN_TTL_SECONDS = 3 * 3600;

export type PlaybackToken = {
	k: "play";
	/** session id */
	s: string;
	/** video id */
	v: string;
	/** user id */
	u: string;
	/** true for staff and tutors, who are not re-checked for enrollment */
	st: boolean;
	e: number;
};

export function readPlaybackToken(token: string | null): PlaybackToken | null {
	return token ? verifyToken<PlaybackToken>(token, "play") : null;
}

/** The video of a lesson when it can be played. */
export async function findPlayableVideo(
	lessonId: string,
): Promise<{ id: string; organizationId: string } | null> {
	const { rows } = await pool.query<{ id: string; organization_id: string }>(
		"select id, organization_id from media.video where lesson_id = $1 and status = 'ready'",
		[lessonId],
	);
	return rows[0]
		? { id: rows[0].id, organizationId: rows[0].organization_id }
		: null;
}

/**
 * Takes a place in the stream cap. With `replaceOthers` (a new playback) the
 * person's other sessions of this video end, so a second tab does not count twice.
 * Returns false when the cap is reached.
 */
async function admit(input: {
	sessionId: string;
	videoId: string;
	userId: string;
	replaceOthers: boolean;
}): Promise<boolean> {
	return inTransaction(async (client) => {
		// One lock for the whole cap, so two playbacks cannot both take the last place.
		await client.query(
			"select pg_advisory_xact_lock(hashtext('media-streams'))",
		);
		const { rows: video } = await client.query<{ organization_id: string }>(
			"select organization_id from media.video where id = $1 and status = 'ready'",
			[input.videoId],
		);
		if (!video[0]) return false;
		if (input.replaceOthers) {
			await client.query(
				"delete from media.playback_session where video_id = $1 and user_id = $2",
				[input.videoId, input.userId],
			);
		}
		const { rows: live } = await client.query<{ count: string }>(
			`select count(*) from media.playback_session
			 where last_seen_at > now() - make_interval(secs => $1) and id <> $2`,
			[LIVE_SECONDS, input.sessionId],
		);
		if (Number(live[0]?.count ?? 0) >= mediaConfig().maxStreams) return false;
		const { rows: saved } = await client.query<{ inserted: boolean }>(
			`insert into media.playback_session (id, video_id, user_id) values ($1, $2, $3)
			 on conflict (id) do update set last_seen_at = now()
			 returning (xmax = 0) as inserted`,
			[input.sessionId, input.videoId, input.userId],
		);
		if (saved[0]?.inserted) {
			await addUsage(input.videoId, video[0].organization_id, { plays: 1 });
		}
		return true;
	});
}

async function addUsage(
	videoId: string,
	organizationId: string,
	usage: { plays?: number; seconds?: number; bytes?: number },
) {
	await pool.query(
		`insert into media.playback_usage (video_id, organization_id, plays, seconds_watched, bytes_served)
		 values ($1, $2, $3, $4, $5)
		 on conflict (video_id, day) do update set
		   plays = media.playback_usage.plays + excluded.plays,
		   seconds_watched = media.playback_usage.seconds_watched + excluded.seconds_watched,
		   bytes_served = media.playback_usage.bytes_served + excluded.bytes_served`,
		[
			videoId,
			organizationId,
			usage.plays ?? 0,
			usage.seconds ?? 0,
			usage.bytes ?? 0,
		],
	);
}

/** Starts a playback. `full` means the stream cap is reached. */
export async function startPlayback(input: {
	videoId: string;
	userId: string;
	staff: boolean;
}): Promise<{ ok: true; token: string } | { ok: false; reason: "full" }> {
	const sessionId = randomUUID();
	const admitted = await admit({ ...input, sessionId, replaceOthers: true });
	if (!admitted) return { ok: false, reason: "full" };
	const token = signToken({
		k: "play",
		s: sessionId,
		v: input.videoId,
		u: input.userId,
		st: input.staff,
		e: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
	} satisfies PlaybackToken);
	return { ok: true, token };
}

/**
 * Keeps a playback alive and records usage. `denied` means the access ended
 * (refund, revoked); `full` means the session had expired and the cap is reached now.
 */
export async function heartbeat(
	claims: PlaybackToken,
	usage: { seconds: number; bytes: number },
): Promise<"ok" | "full" | "denied"> {
	if (!claims.st && !(await stillEnrolled(claims.v, claims.u))) {
		await pool.query("delete from media.playback_session where id = $1", [
			claims.s,
		]);
		return "denied";
	}
	const { rowCount } = await pool.query(
		"update media.playback_session set last_seen_at = now() where id = $1 and video_id = $2",
		[claims.s, claims.v],
	);
	if (!rowCount) {
		// Expired while paused: take a place again if there is one.
		const admitted = await admit({
			sessionId: claims.s,
			videoId: claims.v,
			userId: claims.u,
			replaceOthers: false,
		});
		if (!admitted) return "full";
	}
	const { rows } = await pool.query<{ organization_id: string }>(
		"select organization_id from media.video where id = $1",
		[claims.v],
	);
	if (rows[0]) {
		await addUsage(claims.v, rows[0].organization_id, {
			seconds: Math.max(0, Math.min(usage.seconds, 120)),
			bytes: Math.max(0, Math.min(usage.bytes, 200 * 1024 ** 2)),
		});
	}
	return "ok";
}

async function stillEnrolled(
	videoId: string,
	userId: string,
): Promise<boolean> {
	const { rows } = await pool.query<{
		course_id: string;
		organization_id: string;
	}>(
		`select l.course_id, v.organization_id from media.video v
		 join catalog.lesson l on l.id = v.lesson_id where v.id = $1`,
		[videoId],
	);
	if (!rows[0]) return false;
	return (await findEnrollment(rows[0].course_id, userId)) !== null;
}

/** The 16 raw bytes of the video's AES-128 key, if the session is still valid. */
export async function keyFor(claims: PlaybackToken): Promise<Buffer | null> {
	const query = () =>
		pool.query<{ key_encrypted: string | null }>(
			`select v.key_encrypted from media.video v
			 join media.playback_session s on s.video_id = v.id
			 where v.id = $1 and s.id = $2 and v.status = 'ready'`,
			[claims.v, claims.s],
		);
	let { rows } = await query();
	if (!rows[0]) {
		// hls.js asks for the key again when it switches quality. A paused or idle
		// playback may have lost its place meanwhile; the signed token is still
		// valid, so take the place back (this still respects the stream cap).
		const admitted = await admit({
			sessionId: claims.s,
			videoId: claims.v,
			userId: claims.u,
			replaceOthers: false,
		});
		if (!admitted) return null;
		({ rows } = await query());
	}
	const box = rows[0]?.key_encrypted;
	const keyBase64 = process.env.SECRETS_ENCRYPTION_KEY;
	if (!box || !keyBase64) return null;
	return Buffer.from(decryptSecret(box, keyBase64), "base64");
}

/**
 * Signature nginx checks with secure_link: md5("<exp>/<videoId> <secret>") in
 * base64url. It covers every file of the video, so one signature serves the
 * whole playback until it expires.
 */
function segmentSignature(videoId: string, expires: number): string {
	return createHash("md5")
		.update(`${expires}/${videoId} ${secret("MEDIA_SECRET")}`)
		.digest("base64url");
}

/**
 * The playlist for one playback: stored by the encoder, rewritten so that the
 * key comes from the app (with the token) and every segment has a signed URL.
 */
export async function renderPlaylist(
	claims: PlaybackToken,
	token: string,
	name: string,
): Promise<string | null> {
	if (!/^(master|\d{3,4}p)$/.test(name)) return null;
	let source: string;
	try {
		source = await readFile(
			path.join(hlsDir(claims.v), `${name}.m3u8`),
			"utf8",
		);
	} catch {
		return null;
	}
	const prefix = `${mediaConfig().publicUrl}/hls/${segmentSignature(claims.v, claims.e)}/${claims.e}/${claims.v}/`;
	return source
		.split("\n")
		.map((line) => {
			if (line.startsWith("#EXT-X-KEY")) {
				return line.replace(
					/URI="[^"]*"/,
					`URI="/api/media/key/${claims.v}?t=${token}"`,
				);
			}
			if (line.trim() === "" || line.startsWith("#")) return line;
			return name === "master"
				? `${line.replace(/\.m3u8$/, "")}?t=${token}`
				: prefix + line.trim();
		})
		.join("\n");
}
