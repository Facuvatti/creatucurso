import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { can } from "../areas/identity/permissions.ts";
import { PanelCoursePage } from "../components/pages/panel-course-page.tsx";
import {
	type ActionResult,
	addLesson,
	addModule,
	enrollStudentByEmail,
	getPanelCourse,
} from "../server/catalog.functions.ts";
import { getCertificatePanel } from "../server/certificates.functions.ts";
import {
	addTutorByEmail,
	getCourseTutors,
	removeTutor,
} from "../server/community.functions.ts";
import { getCourseVideos } from "../server/media.functions.ts";
import { setCoursePrice } from "../server/payments.functions.ts";

export const Route = createFileRoute("/panel/cursos/$courseId")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		if (!can(context.roles, { course: ["update"] })) throw notFound();
	},
	loader: async ({ params }) => {
		const course = await getPanelCourse({
			data: { courseId: params.courseId },
		});
		if (!course) throw notFound();
		const tutors = await getCourseTutors({
			data: { courseId: params.courseId },
		});
		const videos = await getCourseVideos({
			data: { courseId: params.courseId },
		});
		const certificates = await getCertificatePanel({
			data: { courseId: params.courseId },
		});
		return { course, tutors, videos, certificates };
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.course.name ?? "Curso"} | Panel` }],
	}),
	component: PanelCourseRoute,
});

function PanelCourseRoute() {
	const { course, tutors, videos, certificates } = Route.useLoaderData();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();

	// Only the video statuses are polled (not the whole page), while a video is
	// being processed, or for a minute after the page opens/changes in case an
	// upload just finished and tusd's post-finish hook has not been recorded yet.
	const [liveVideos, setLiveVideos] = useState(videos);
	const [seenVideos, setSeenVideos] = useState(videos);
	if (videos !== seenVideos) {
		setSeenVideos(videos);
		setLiveVideos(videos);
	}
	const [graceTicks, setGraceTicks] = useState(12);
	const states = Object.values(liveVideos).map((video) => video.status);
	const processing = states.some(
		(status) => status === "uploaded" || status === "encoding",
	);
	const maybeFinishing = states.includes("uploading") && graceTicks > 0;
	const courseId = course.id;
	useEffect(() => {
		if (!processing && !maybeFinishing) return;
		const timer = setInterval(async () => {
			setGraceTicks((ticks) => Math.max(0, ticks - 1));
			try {
				setLiveVideos(await getCourseVideos({ data: { courseId } }));
			} catch {
				// Offline for a moment: try again on the next tick.
			}
		}, 5000);
		return () => clearInterval(timer);
	}, [processing, maybeFinishing, courseId]);

	async function run(action: () => Promise<ActionResult>, success?: string) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		if (result.ok) await router.invalidate();
		setPending(false);
	}

	return (
		<PanelCoursePage
			course={course}
			tutors={tutors}
			videos={liveVideos}
			certificates={certificates}
			onCertificatesChanged={() => router.invalidate()}
			onVideoChanged={() => router.invalidate()}
			message={message}
			pending={pending}
			onAddModule={(title) =>
				run(() => addModule({ data: { courseId: course.id, title } }))
			}
			onAddLesson={(values) =>
				run(() => addLesson({ data: { courseId: course.id, ...values } }))
			}
			onSetPrice={(values) =>
				run(
					() =>
						setCoursePrice({
							data: {
								courseId: course.id,
								price: Number.isFinite(values.price) ? values.price : null,
								currency: values.currency as "ARS",
							},
						}),
					"Precio guardado.",
				)
			}
			onEnroll={(email) =>
				run(
					() => enrollStudentByEmail({ data: { courseId: course.id, email } }),
					"Persona inscripta.",
				)
			}
			onAddTutor={(email) =>
				run(
					() => addTutorByEmail({ data: { courseId: course.id, email } }),
					"Tutor agregado.",
				)
			}
			onRemoveTutor={(userId) =>
				run(
					() => removeTutor({ data: { courseId: course.id, userId } }),
					"Tutor quitado.",
				)
			}
		/>
	);
}
