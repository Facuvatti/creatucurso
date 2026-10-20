import { lazy, Suspense, useEffect, useState } from "react";

// hls.js only exists in the browser: the player is never rendered on the server.
const VideoPlayer = lazy(() => import("./video-player.tsx"));

type Props = {
	status: string;
	courseSlug: string;
	lessonSlug: string;
	viewerEmail: string;
};

/** The lesson's protected video, or the reason there is none yet. */
export function LessonVideo({ status, ...player }: Props) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	if (status === "failed")
		return <p>El video de esta clase no está disponible.</p>;
	if (status !== "ready")
		return <p>El video de esta clase se está procesando.</p>;
	if (!mounted) return <p>Cargando video...</p>;
	return (
		<Suspense fallback={<p>Cargando video...</p>}>
			<VideoPlayer {...player} />
		</Suspense>
	);
}
