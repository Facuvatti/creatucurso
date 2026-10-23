import { useEffect, useRef, useState } from "react";
import type { LessonPageData } from "../../server/catalog.functions.ts";
import {
	reportEmbedResult,
	startEmbedSession,
} from "../../server/catalog.functions.ts";

type Ok = Extract<LessonPageData, { kind: "ok" }>;
export type Embed = NonNullable<Ok["embed"]>;

type Props = {
	embed: Embed;
	courseSlug: string;
	lessonSlug: string;
	lessonId: string;
	title: string;
	/** Called after a result was stored, so the page can refresh. */
	onReported: () => void;
};

type Incoming = { type: string; payload: Record<string, unknown> };

/** Hand-validates a message from the embedded app. */
function parseMessage(data: unknown): Incoming | null {
	if (typeof data !== "object" || data === null) return null;
	const message = data as Record<string, unknown>;
	if (message.source !== "lesson-sdk" || message.v !== 1) return null;
	if (typeof message.type !== "string") return null;
	const payload =
		typeof message.payload === "object" &&
		message.payload !== null &&
		!Array.isArray(message.payload)
			? (message.payload as Record<string, unknown>)
			: {};
	return { type: message.type, payload };
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function metadataOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function EmbedFrame({
	embed,
	courseSlug,
	lessonSlug,
	lessonId,
	title,
	onReported,
}: Props) {
	const frame = useRef<HTMLIFrameElement>(null);
	const onReportedRef = useRef(onReported);
	onReportedRef.current = onReported;
	const [message, setMessage] = useState<string>();
	const [busy, setBusy] = useState(false);

	const { origin } = embed;
	useEffect(() => {
		async function onMessage(event: MessageEvent) {
			const target = frame.current?.contentWindow;
			if (event.origin !== origin || !target || event.source !== target) return;
			const incoming = parseMessage(event.data);
			if (!incoming) return;

			if (incoming.type === "lesson:hello") {
				const session = await startEmbedSession({
					data: { courseSlug, lessonSlug },
				});
				if (!session.ok) {
					setMessage(session.message);
					return;
				}
				const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
				target.postMessage(
					{
						source: "course-platform",
						v: 1,
						type: "lesson:init",
						payload: {
							lessonToken: session.token,
							lessonId,
							locale: "es",
							theme,
						},
					},
					origin,
				);
				return;
			}

			if (incoming.type === "lesson:complete") {
				const { payload } = incoming;
				const score = finiteNumber(payload.score);
				const maxScore = finiteNumber(payload.maxScore);
				const timeSpentSec = finiteNumber(payload.timeSpentSec);
				const metadata = metadataOf(payload.metadata);
				setBusy(true);
				const result = await reportEmbedResult({
					data: {
						courseSlug,
						lessonSlug,
						...(score !== undefined && { score }),
						...(maxScore !== undefined && { maxScore }),
						...(typeof payload.passed === "boolean" && {
							passed: payload.passed,
						}),
						...(timeSpentSec !== undefined && { timeSpentSec }),
						...(metadata && { metadata }),
					},
				});
				setBusy(false);
				setMessage(result.ok ? undefined : result.message);
				if (result.ok) onReportedRef.current();
			}
		}
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [origin, courseSlug, lessonSlug, lessonId]);

	const { result } = embed;
	return (
		<div data-embed>
			<iframe
				ref={frame}
				src={embed.url}
				title={title}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen"
				allow="fullscreen; gamepad"
				referrerPolicy="no-referrer"
				loading="lazy"
			/>
			{busy && <output>Guardando resultado…</output>}
			{message && <output data-status="error">{message}</output>}
			{result ? (
				<p data-embed-result>
					Tu último resultado:{" "}
					{result.score !== null && (
						<strong>
							{result.score}
							{result.maxScore !== null && ` / ${result.maxScore}`}
						</strong>
					)}{" "}
					{result.passed !== null && (
						<strong data-status={result.passed ? "passed" : "failed"}>
							{result.passed ? "Aprobado" : "Desaprobado"}
						</strong>
					)}{" "}
					<small data-verified={result.verified}>
						{result.verified ? "Verificado" : "Reportado por el alumno"}
					</small>
				</p>
			) : (
				<p>
					<small>Todavía no hay resultado para esta clase.</small>
				</p>
			)}
			{embed.verifiedOnly && (
				<p>
					<small>
						Esta clase solo se completa con un resultado verificado por el
						servidor de la app.
					</small>
				</p>
			)}
		</div>
	);
}
