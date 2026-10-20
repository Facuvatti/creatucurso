// Validates an uploaded certificate frame and turns it into a safe PNG
// (ADR-0025). The real type comes from the magic bytes. Raster images are
// re-encoded with ffmpeg and a PDF's first page is flattened with pdftoppm, so
// nothing from the uploaded file survives.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const FRAME_MAX_BYTES = 8 * 1024 * 1024;
const MIN_WIDTH = 1754;
const MIN_HEIGHT = 1240;
const MAX_SIDE = 6000;
const RATIO = Math.SQRT2; // A4: 1.414
const RATIO_TOLERANCE = 0.02;
const PDF_RENDER_WIDTH = 3508;
const TOOL_TIMEOUT_MS = 30_000;

export type FrameResult =
	| { ok: true; png: Buffer; width: number; height: number }
	| { ok: false; message: string };

function reject(message: string): FrameResult {
	return { ok: false, message };
}

function detectType(bytes: Buffer): "pdf" | "png" | "jpeg" | null {
	if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
	if (
		bytes.length > 8 &&
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		return "png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return "jpeg";
	return null;
}

function ratioOk(width: number, height: number): boolean {
	return Math.abs(width / height / RATIO - 1) <= RATIO_TOLERANCE;
}

const RATIO_MESSAGE =
	"El diseño tiene que ser apaisado en formato A4 (proporción 1,414 : 1, con 2 % de tolerancia). En Canva usá 3508 x 2480 px.";

async function probe(
	file: string,
): Promise<{ width: number; height: number } | null> {
	try {
		const { stdout } = await run(
			"ffprobe",
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height",
				"-of",
				"json",
				file,
			],
			{ timeout: TOOL_TIMEOUT_MS },
		);
		const stream = JSON.parse(stdout).streams?.[0];
		const width = Number(stream?.width);
		const height = Number(stream?.height);
		return width > 0 && height > 0 ? { width, height } : null;
	} catch {
		return null;
	}
}

/** Checks the uploaded bytes and returns the safe PNG to store. */
export async function prepareFrame(bytes: Buffer): Promise<FrameResult> {
	if (bytes.length === 0) return reject("El archivo está vacío.");
	if (bytes.length > FRAME_MAX_BYTES) {
		return reject("El archivo pesa más de 8 MB.");
	}
	const type = detectType(bytes);
	if (!type)
		return reject(
			"Subí un archivo PDF, PNG o JPEG. SVG y otros formatos no se aceptan.",
		);

	const dir = await mkdtemp(path.join(tmpdir(), "frame-"));
	try {
		const input = path.join(dir, type === "jpeg" ? "in.jpg" : `in.${type}`);
		await writeFile(input, bytes);
		const output = path.join(dir, "out.png");

		if (type === "pdf") {
			let width: number;
			let height: number;
			try {
				const { stdout } = await run("pdfinfo", ["-f", "1", "-l", "1", input], {
					timeout: TOOL_TIMEOUT_MS,
				});
				const size = /Page\s+1 size:\s+([\d.]+) x ([\d.]+) pts/.exec(stdout);
				if (!size) throw new Error("no size");
				width = Number(size[1]);
				height = Number(size[2]);
			} catch {
				return reject(
					"No se pudo leer el PDF. Revisá que no tenga contraseña ni esté dañado.",
				);
			}
			if (!ratioOk(width, height)) return reject(RATIO_MESSAGE);
			try {
				await run(
					"pdftoppm",
					[
						"-png",
						"-f",
						"1",
						"-l",
						"1",
						"-singlefile",
						"-scale-to-x",
						String(PDF_RENDER_WIDTH),
						"-scale-to-y",
						"-1",
						input,
						path.join(dir, "page"),
					],
					{ timeout: TOOL_TIMEOUT_MS },
				);
				// Render, then re-encode below like any other image.
			} catch {
				return reject(
					"No se pudo convertir el PDF. Probá exportarlo de nuevo desde Canva.",
				);
			}
			return await finish(path.join(dir, "page.png"), output, false);
		}

		return await finish(input, output, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Checks the dimensions, re-encodes to a clean PNG and reads the result. */
async function finish(
	source: string,
	output: string,
	checkMinimum: boolean,
): Promise<FrameResult> {
	const size = await probe(source);
	if (!size) return reject("No se pudo leer la imagen. Puede estar dañada.");
	if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
		return reject(
			"La imagen es demasiado grande: el máximo es 6000 px por lado.",
		);
	}
	if (checkMinimum && (size.width < MIN_WIDTH || size.height < MIN_HEIGHT)) {
		return reject(
			"La imagen es muy chica: el mínimo es 1754 x 1240 px. En Canva usá 3508 x 2480 px.",
		);
	}
	if (!ratioOk(size.width, size.height)) return reject(RATIO_MESSAGE);

	try {
		await run(
			"ffmpeg",
			[
				"-v",
				"error",
				"-y",
				"-i",
				source,
				"-frames:v",
				"1",
				"-map_metadata",
				"-1",
				"-pix_fmt",
				"rgba",
				output,
			],
			{ timeout: TOOL_TIMEOUT_MS },
		);
	} catch {
		return reject("No se pudo procesar la imagen. Puede estar dañada.");
	}
	return {
		ok: true,
		png: await readFile(output),
		width: size.width,
		height: size.height,
	};
}
