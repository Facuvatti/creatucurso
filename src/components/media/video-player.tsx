// Protected HLS player. Loaded only in the browser (see LessonVideo). Deterrence
// only, not protection: the key reaches the browser (ADR-0020).
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
	courseSlug: string;
	lessonSlug: string;
	/** Shown as the moving watermark. */
	viewerEmail: string;
};

const MESSAGES: Record<string, string> = {
	full: "Hay demasiadas reproducciones en este momento. Probá de nuevo en unos minutos.",
	login: "Ingresá para ver el video.",
	denied: "No tenés acceso a este video.",
	ended: "Tu acceso a este video terminó.",
	other: "No se pudo cargar el video.",
};

/** Browser tools take space from the page: a big gap between outer and inner size. */
function devToolsOpen(): boolean {
	return (
		window.outerWidth - window.innerWidth > 160 ||
		window.outerHeight - window.innerHeight > 160
	);
}

export default function VideoPlayer({
	courseSlug,
	lessonSlug,
	viewerEmail,
}: Props) {
	const box = useRef<HTMLDivElement>(null);
	const video = useRef<HTMLVideoElement>(null);
	const hls = useRef<Hls | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [error, setError] = useState<string>();
	const [levels, setLevels] = useState<number[]>([]);
	const [quality, setQuality] = useState(-1);
	const [spot, setSpot] = useState({ top: 10, left: 10 });
	const [toolsOpen, setToolsOpen] = useState(false);
	const toolsOpenRef = useRef(false);

	const stop = useCallback((key: string) => {
		video.current?.pause();
		hls.current?.destroy();
		hls.current = null;
		setError(MESSAGES[key] ?? MESSAGES.other);
	}, []);

	// Session, hls.js and heartbeat.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the effect on retry.
	useEffect(() => {
		const element = video.current;
		if (!element) return;
		let cancelled = false;
		let token = "";
		let bytes = 0;
		let timer: ReturnType<typeof setInterval> | undefined;
		setError(undefined);

		async function beat(seconds: number) {
			const sent = bytes;
			bytes = 0;
			const response = await fetch("/api/media/heartbeat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, seconds, bytes: sent }),
			}).catch(() => null);
			if (cancelled || !response || response.ok) return;
			stop(response.status === 429 ? "full" : "ended");
		}

		async function start() {
			const response = await fetch("/api/media/session", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ courseSlug, lessonSlug }),
			}).catch(() => null);
			if (cancelled) return;
			if (!response?.ok) {
				const status = response?.status;
				setError(
					MESSAGES[
						status === 429
							? "full"
							: status === 401
								? "login"
								: status === 403
									? "denied"
									: "other"
					],
				);
				return;
			}
			const session = (await response.json()) as {
				token: string;
				manifestUrl: string;
				heartbeatMs: number;
			};
			if (cancelled || !element) return;
			token = session.token;

			if (Hls.isSupported()) {
				const player = new Hls({ maxBufferLength: 30 });
				hls.current = player;
				player.on(Hls.Events.MANIFEST_PARSED, (_, data) =>
					setLevels(data.levels.map((level) => level.height)),
				);
				player.on(Hls.Events.FRAG_LOADED, (_, data) => {
					bytes += data.frag.stats.total;
				});
				player.on(Hls.Events.ERROR, (_, data) => {
					if (data.fatal) stop("other");
				});
				player.loadSource(session.manifestUrl);
				player.attachMedia(element);
			} else if (element.canPlayType("application/vnd.apple.mpegurl")) {
				element.src = session.manifestUrl; // Safari plays HLS natively
			} else {
				setError("Tu navegador no puede reproducir este video.");
				return;
			}

			// While playing, tell the server every few seconds; a paused video stops
			// beating and gives its place back after a short while.
			timer = setInterval(() => {
				if (!element.paused && !element.ended) {
					void beat(session.heartbeatMs / 1000);
				}
			}, session.heartbeatMs);
		}

		const onPlay = () => {
			if (toolsOpenRef.current) element.pause();
			else if (token) void beat(0); // takes the place again if it expired
		};
		element.addEventListener("play", onPlay);
		void start();

		return () => {
			cancelled = true;
			clearInterval(timer);
			element.removeEventListener("play", onPlay);
			hls.current?.destroy();
			hls.current = null;
		};
	}, [courseSlug, lessonSlug, attempt, stop]);

	// Watermark: a new place every few seconds.
	useEffect(() => {
		const timer = setInterval(
			() =>
				setSpot({
					top: 8 + Math.random() * 72,
					left: 4 + Math.random() * 60,
				}),
			4000,
		);
		return () => clearInterval(timer);
	}, []);

	// Deterrence: no context menu on the video, no shortcuts to the browser tools,
	// pause while they are open. Keyboard use of the player controls is untouched.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			const tools =
				event.key === "F12" ||
				((event.ctrlKey || event.metaKey) &&
					event.shiftKey &&
					["i", "j", "c"].includes(key)) ||
				((event.ctrlKey || event.metaKey) && event.altKey && key === "i") ||
				((event.ctrlKey || event.metaKey) && key === "u");
			if (tools) event.preventDefault();
		};
		const check = () => {
			const open = devToolsOpen();
			toolsOpenRef.current = open;
			setToolsOpen(open);
			if (open) video.current?.pause();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", check);
		const timer = setInterval(check, 1000);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", check);
			clearInterval(timer);
		};
	}, []);

	return (
		<div data-component="video-player">
			<div
				ref={box}
				style={{ position: "relative", background: "#000", maxWidth: 960 }}
				onContextMenu={(event) => event.preventDefault()}
			>
				{/* biome-ignore lint/a11y/useMediaCaption: lesson videos have no caption tracks yet. */}
				<video
					ref={video}
					controls
					playsInline
					controlsList="nodownload nofullscreen noplaybackrate"
					disablePictureInPicture
					style={{ width: "100%", display: "block" }}
				/>
				<span
					aria-hidden="true"
					style={{
						position: "absolute",
						top: `${spot.top}%`,
						left: `${spot.left}%`,
						transition: "top 1.5s ease, left 1.5s ease",
						color: "rgba(255,255,255,0.4)",
						textShadow: "0 0 3px rgba(0,0,0,0.6)",
						fontSize: "0.9rem",
						pointerEvents: "none",
						userSelect: "none",
					}}
				>
					{viewerEmail}
				</span>
			</div>

			<p>
				{levels.length > 1 && (
					<label>
						Calidad{" "}
						<select
							value={quality}
							onChange={(event) => {
								const level = Number(event.target.value);
								setQuality(level);
								if (hls.current) hls.current.currentLevel = level;
							}}
						>
							<option value={-1}>Automática</option>
							{levels.map((height, index) => (
								<option key={height} value={index}>
									{height}p
								</option>
							))}
						</select>
					</label>
				)}{" "}
				{/* The native fullscreen button is off: it would hide the watermark. */}
				<button
					type="button"
					onClick={() => {
						if (document.fullscreenElement) void document.exitFullscreen();
						else void box.current?.requestFullscreen();
					}}
				>
					Pantalla completa
				</button>
			</p>

			{toolsOpen && (
				<p role="alert">
					Detectamos las herramientas del navegador abiertas. Cerralas para
					seguir viendo el video.
				</p>
			)}
			{error && (
				<p role="alert">
					{error}{" "}
					<button type="button" onClick={() => setAttempt((n) => n + 1)}>
						Reintentar
					</button>
				</p>
			)}
		</div>
	);
}
