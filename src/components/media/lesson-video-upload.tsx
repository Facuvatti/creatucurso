import { useRef, useState } from "react";
import type { VideoInfo } from "../../areas/media/types.ts";
import {
	removeLessonVideo,
	startVideoUpload,
} from "../../server/media.functions.ts";

type Props = {
	lessonId: string;
	video: VideoInfo | undefined;
	/** Called when the video changed and the panel should reload its data. */
	onChanged: () => void;
};

const ACCEPTED = /\.(mp4|mov|mkv|webm)$/i;

function tusMessage(error: unknown): string {
	const response = (error as { originalResponse?: unknown }).originalResponse as
		| { getStatus(): number; getBody(): string }
		| null
		| undefined;
	if (response) {
		const body = response.getBody().trim();
		if (response.getStatus() === 413)
			return "El archivo supera el tamaño máximo.";
		if (body && body.length < 200) return body;
		return "No se pudo subir el video. Probá de nuevo.";
	}
	return "Se cortó la conexión. Elegí el mismo archivo para continuar donde quedó.";
}

/** Upload of a lesson's video (resumable, tus) and the state of its processing. */
export function LessonVideoUpload({ lessonId, video, onChanged }: Props) {
	const [progress, setProgress] = useState<number | null>(null);
	const [message, setMessage] = useState<string>();
	const abort = useRef<(() => void) | null>(null);

	async function upload(file: File) {
		setMessage(undefined);
		if (!ACCEPTED.test(file.name)) {
			setMessage("Formato no admitido. Usá MP4, MOV, MKV o WebM.");
			return;
		}
		const start = await startVideoUpload({
			data: { lessonId, size: file.size },
		});
		if (!start.ok) {
			setMessage(start.message);
			return;
		}
		const tus = await import("tus-js-client");
		const task = new tus.Upload(file, {
			endpoint: start.endpoint,
			headers: { Authorization: `Bearer ${start.token}` },
			metadata: {
				videoId: start.videoId,
				filename: file.name,
				filetype: file.type,
			},
			chunkSize: 16 * 1024 * 1024,
			// Short network cuts are retried by themselves.
			retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
			removeFingerprintOnSuccess: true,
			onProgress: (sent, total) =>
				setProgress(Math.round((sent / total) * 100)),
			onError: (error) => {
				setProgress(null);
				setMessage(tusMessage(error));
			},
			onSuccess: () => {
				setProgress(null);
				onChanged();
			},
		});
		abort.current = () => task.abort();
		setProgress(0);
		// Resume a previous upload of the same file after a cut or a reload.
		const previous = await task.findPreviousUploads();
		if (previous[0]) task.resumeFromPreviousUpload(previous[0]);
		task.start();
	}

	async function remove() {
		abort.current?.();
		setProgress(null);
		const result = await removeLessonVideo({ data: { lessonId } });
		setMessage(result.ok ? undefined : result.message);
		if (result.ok) onChanged();
	}

	const status = video?.status;
	const busy = progress !== null;

	return (
		<div data-component="lesson-video">
			<small>
				Video:{" "}
				<strong>
					{busy
						? `subiendo ${progress}%`
						: status === "uploading"
							? "subida incompleta"
							: status === "uploaded" || status === "encoding"
								? "procesando"
								: status === "ready"
									? "listo"
									: status === "failed"
										? "error"
										: "sin video"}
				</strong>
			</small>
			{busy && (
				<progress
					max={100}
					value={progress ?? 0}
					aria-label="Progreso de la subida"
				/>
			)}
			{status === "uploading" && !busy && (
				<small> Elegí el mismo archivo para continuar la subida.</small>
			)}
			{status === "failed" && video?.error && (
				<small role="alert"> {video.error}</small>
			)}
			{status === "ready" && video?.durationSeconds != null && (
				<small>
					{" "}
					({Math.round(video.durationSeconds / 60)} min,{" "}
					{video.renditions.map((h) => `${h}p`).join(" y ")})
				</small>
			)}{" "}
			{status !== "encoding" && status !== "uploaded" && (
				<label>
					<input
						type="file"
						accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm"
						disabled={busy}
						onChange={(event) => {
							const file = event.currentTarget.files?.[0];
							event.currentTarget.value = "";
							if (file) void upload(file);
						}}
					/>
				</label>
			)}{" "}
			{video && status !== "encoding" && status !== "uploaded" && (
				<button type="button" onClick={remove}>
					Quitar video
				</button>
			)}
			{message && <output role="alert"> {message}</output>}
		</div>
	);
}
