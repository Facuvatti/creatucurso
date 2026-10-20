// The encoder: its own process (`pnpm media:encode`). Takes uploaded videos one
// at a time, checks them with ffprobe, encodes encrypted HLS with ffmpeg and
// cleans up. The queue is the `status` column of media.video.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hlsDir, mediaConfig, removeVideoFiles } from "../areas/media/media.ts";
import { inTransaction, pool } from "../server/db.server.ts";
import { encryptSecret } from "../shared/crypto/secret-box.ts";

const POLL_MS = 3000;
const HOUSEKEEPING_MS = 60_000;
const SEGMENT_SECONDS = 6;
const KEEP_ORIGINAL_DAYS = 7;
/** Height and video bitrate (ADR-0012: the ladder stops at 720p). */
const LADDER = [
	{ height: 480, bitrate: "1200k" },
	{ height: 720, bitrate: "2500k" },
];

/** A problem the creator can understand; shown in the panel as is. */
class UserError extends Error {}

function log(level: "info" | "error", msg: string, extra: object = {}) {
	console.log(
		JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra }),
	);
}

// ------------------------------------------------------------------- ffprobe

type Probe = {
	duration: number;
	width: number;
	height: number;
	hasAudio: boolean;
};

function run(
	command: string,
	args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		// Keep only the tail: ffmpeg writes a lot.
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

/** Checks the real container and codecs, the duration and the resolution. */
async function probe(file: string): Promise<Probe> {
	const result = await run("ffprobe", [
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		file,
	]);
	if (result.code !== 0) {
		throw new UserError("El archivo no es un video válido o está dañado.");
	}
	const info = JSON.parse(result.stdout) as {
		format?: { format_name?: string; duration?: string };
		streams?: { codec_type?: string; width?: number; height?: number }[];
	};
	// MP4 and MOV share the "mov" demuxer; MKV and WebM share "matroska".
	const container = info.format?.format_name ?? "";
	if (!container.includes("mov") && !container.includes("matroska")) {
		throw new UserError("Formato no admitido. Usá MP4, MOV, MKV o WebM.");
	}
	const video = info.streams?.find((s) => s.codec_type === "video");
	if (!video?.width || !video.height) {
		throw new UserError("El archivo no tiene una pista de video.");
	}
	const duration = Number(info.format?.duration);
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new UserError("No se pudo leer la duración del video.");
	}
	const { maxSeconds } = mediaConfig();
	if (duration > maxSeconds) {
		throw new UserError(
			`El video dura más del máximo permitido (${Math.round(maxSeconds / 60)} minutos).`,
		);
	}
	return {
		duration: Math.round(duration),
		width: video.width,
		height: video.height,
		hasAudio: info.streams?.some((s) => s.codec_type === "audio") ?? false,
	};
}

// -------------------------------------------------------------------- ffmpeg

/** Renditions to encode: the ladder up to the source height, or the source itself when smaller. */
function renditionsFor(sourceHeight: number) {
	const steps = LADDER.filter((step) => step.height <= sourceHeight);
	return steps.length > 0
		? steps
		: [{ height: sourceHeight - (sourceHeight % 2), bitrate: "800k" }];
}

/**
 * The ffmpeg arguments for one video: a rendition per ladder step, 6-second
 * segments, AES-128 with the key info file, master playlist. Exported so the
 * encoding speed test (ADR-0021) runs exactly this command.
 */
export function ffmpegArgs(input: {
	source: string;
	outDir: string;
	keyInfoFile: string;
	sourceHeight: number;
	hasAudio: boolean;
	videoCodec?: string[];
}): { args: string[]; heights: number[] } {
	const steps = renditionsFor(input.sourceHeight);
	const names = steps.map((_, i) => `[s${i}]`).join("");
	const filters =
		steps.length === 1
			? `[0:v:0]scale=-2:${steps[0]?.height},format=yuv420p[v0]`
			: `[0:v:0]split=${steps.length}${names};${steps
					.map(
						(step, i) => `[s${i}]scale=-2:${step.height},format=yuv420p[v${i}]`,
					)
					.join(";")}`;

	const args = ["-y", "-i", input.source, "-filter_complex", filters];
	steps.forEach((_, i) => {
		args.push("-map", `[v${i}]`);
		if (input.hasAudio) args.push("-map", "0:a:0");
	});
	args.push(
		...(input.videoCodec ?? [
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-profile:v",
			"main",
			"-sc_threshold",
			"0",
		]),
		"-force_key_frames",
		`expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
	);
	steps.forEach((step, i) => {
		const rate = Number.parseInt(step.bitrate, 10);
		args.push(
			`-b:v:${i}`,
			step.bitrate,
			`-maxrate:v:${i}`,
			`${Math.round(rate * 1.2)}k`,
			`-bufsize:v:${i}`,
			`${rate * 2}k`,
		);
	});
	if (input.hasAudio) args.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
	args.push(
		"-f",
		"hls",
		"-hls_time",
		String(SEGMENT_SECONDS),
		"-hls_playlist_type",
		"vod",
		"-hls_flags",
		"independent_segments",
		"-hls_key_info_file",
		input.keyInfoFile,
		"-master_pl_name",
		"master.m3u8",
		"-var_stream_map",
		steps
			.map(
				(step, i) =>
					`v:${i}${input.hasAudio ? `,a:${i}` : ""},name:${step.height}p`,
			)
			.join(" "),
		"-hls_segment_filename",
		path.join(input.outDir, "%v_%05d.ts"),
		path.join(input.outDir, "%v.m3u8"),
	);
	return { args, heights: steps.map((s) => s.height) };
}

async function encode(job: { id: string; path: string }): Promise<void> {
	const info = await probe(job.path);
	const outDir = hlsDir(job.id);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	// One random key per video. The key file lives only while ffmpeg runs.
	const key = randomBytes(16);
	const workDir = await mkdtemp(path.join(tmpdir(), "encode-"));
	try {
		const keyFile = path.join(workDir, "key.bin");
		const keyInfoFile = path.join(workDir, "key.info");
		await writeFile(keyFile, key);
		// Line 1 is the URI written in the playlist (the app rewrites it per
		// playback), line 2 the file ffmpeg encrypts with.
		await writeFile(keyInfoFile, `/api/media/key/${job.id}\n${keyFile}\n`);

		const { args, heights } = ffmpegArgs({
			source: job.path,
			outDir,
			keyInfoFile,
			sourceHeight: info.height,
			hasAudio: info.hasAudio,
		});
		// nice keeps the website responsive while ffmpeg uses every core.
		const result = await run("nice", ["-n", "10", "ffmpeg", ...args]);
		if (result.code !== 0) {
			log("error", "ffmpeg failed", { id: job.id, stderr: result.stderr });
			throw new UserError(
				"No se pudo codificar el video. Probá con otro archivo.",
			);
		}

		const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
		if (!encryptionKey) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
		await pool.query(
			`update media.video set status = 'ready', error = null,
			   duration_seconds = $2, width = $3, height = $4, renditions = $5,
			   key_encrypted = $6, updated_at = now(),
			   original_delete_after = now() + make_interval(days => $7)
			 where id = $1`,
			[
				job.id,
				info.duration,
				info.width,
				info.height,
				heights,
				encryptSecret(key.toString("base64"), encryptionKey),
				KEEP_ORIGINAL_DAYS,
			],
		);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------- queue

/** Takes the oldest uploaded video. SKIP LOCKED keeps a second encoder from taking it too. */
async function claim(): Promise<{ id: string; path: string } | null> {
	return inTransaction(async (client) => {
		const { rows } = await client.query<{ id: string; original_path: string }>(
			`select id, original_path from media.video
			 where status = 'uploaded' order by created_at limit 1
			 for update skip locked`,
		);
		const job = rows[0];
		if (!job) return null;
		await client.query(
			"update media.video set status = 'encoding', error = null, updated_at = now() where id = $1",
			[job.id],
		);
		return { id: job.id, path: job.original_path };
	});
}

async function runNextJob(): Promise<boolean> {
	const job = await claim();
	if (!job) return false;
	log("info", "encoding started", { id: job.id });
	const started = Date.now();
	try {
		await encode(job);
		log("info", "encoding finished", { id: job.id, ms: Date.now() - started });
	} catch (error) {
		const reason =
			error instanceof UserError
				? error.message
				: "Ocurrió un error al procesar el video.";
		if (!(error instanceof UserError)) {
			log("error", "encoding crashed", { id: job.id, error: String(error) });
		}
		// A failed job keeps the original so it can be inspected.
		await pool.query(
			"update media.video set status = 'failed', error = $2, updated_at = now() where id = $1",
			[job.id, reason],
		);
		await rm(hlsDir(job.id), { recursive: true, force: true });
	}
	return true;
}

/** Deletes originals past their date and abandoned uploads; refreshes the CORS map. */
async function housekeeping() {
	const { rows: expired } = await pool.query<{
		id: string;
		original_path: string;
	}>(
		`select id, original_path from media.video
		 where status = 'ready' and original_path is not null and original_delete_after < now()`,
	);
	for (const video of expired) {
		await rm(video.original_path, { force: true });
		await rm(`${video.original_path}.info`, { force: true });
		await pool.query(
			"update media.video set original_path = null, updated_at = now() where id = $1",
			[video.id],
		);
		log("info", "original deleted", { id: video.id });
	}

	const { rows: abandoned } = await pool.query<{ id: string }>(
		`delete from media.video where status = 'uploading' and updated_at < now() - interval '3 days'
		 returning id`,
	);
	for (const video of abandoned) await removeVideoFiles(video.id);

	await pool.query(
		"delete from media.playback_session where last_seen_at < now() - interval '1 day'",
	);
	await writeAllowedOrigins();
}

/**
 * nginx allows CORS for the platform's subdomains by pattern; verified custom
 * domains are listed in this file, which nginx includes (ADR-0020).
 */
async function writeAllowedOrigins() {
	const { rows } = await pool.query<{ domain: string }>(
		`select "customDomain" as domain from auth.organization
		 where "customDomain" is not null and "customDomainVerifiedAt" is not null`,
	);
	const scheme = process.env.PUBLIC_URL_SCHEME ?? "https";
	const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "";
	const content = `${rows
		.map((row) => {
			const origin = `${scheme}://${row.domain}${port}`;
			return `"${origin}" "${origin}";`;
		})
		.join("\n")}\n`;
	const file = path.join(mediaConfig().root, "allowed-origins.map");
	const current = await readFile(file, "utf8").catch(() => null);
	if (current === content) return;
	await writeFile(`${file}.tmp`, content);
	await rename(`${file}.tmp`, file);
}

// ---------------------------------------------------------------------- main

async function main() {
	const port = Number(process.env.MEDIA_ENCODER_PORT ?? 3102);
	let lastTickAt = Date.now();
	let stopping = false;

	createServer((request, response) => {
		if (request.url === "/health") {
			const ok = Date.now() - lastTickAt < 5 * 60_000;
			response.writeHead(ok ? 200 : 503, {
				"Content-Type": "application/json",
			});
			response.end(JSON.stringify({ ok, lastTickAt }));
			return;
		}
		response.writeHead(404).end();
	}).listen(port, () => log("info", "encoder started", { port }));

	process.on("SIGTERM", () => {
		stopping = true;
	});
	process.on("SIGINT", () => {
		stopping = true;
	});

	await mkdir(path.join(mediaConfig().root, "uploads"), { recursive: true });
	// A crash mid-encode leaves the video as 'encoding': queue it again.
	await pool.query(
		"update media.video set status = 'uploaded' where status = 'encoding'",
	);

	let lastHousekeeping = 0;
	while (!stopping) {
		try {
			if (Date.now() - lastHousekeeping > HOUSEKEEPING_MS) {
				lastHousekeeping = Date.now();
				await housekeeping();
			}
			lastTickAt = Date.now();
			if (await runNextJob()) continue;
		} catch (error) {
			log("error", "encoder tick failed", { error: String(error) });
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	await pool.end();
	process.exit(0);
}

// Only start when run as the entry (the speed test imports ffmpegArgs).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
