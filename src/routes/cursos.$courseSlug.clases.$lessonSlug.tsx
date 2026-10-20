import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { CommentsSection } from "../components/community/comments-section.tsx";
import { LessonPage } from "../components/pages/lesson-page.tsx";
import { completeLesson, getLessonPage } from "../server/catalog.functions.ts";
import {
	getLessonComments,
	postComment,
	setCommentVisibility,
} from "../server/community.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/clases/$lessonSlug")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const result = await getLessonPage({ data: params });
		if (result.kind === "notFound") throw notFound();
		const comments =
			result.kind === "ok" ? await getLessonComments({ data: params }) : null;
		return { page: result, comments };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title:
					loaderData?.page.kind === "ok"
						? `${loaderData.page.lesson.title} | ${loaderData.page.course.name}`
						: "Clase",
			},
		],
	}),
	component: LessonRoute,
});

function LessonRoute() {
	const { page: data, comments } = Route.useLoaderData();
	const params = Route.useParams();
	const { origin, appOrigin, user } = Route.useRouteContext();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [commentMessage, setCommentMessage] = useState<string>();

	if (data.kind === "login") {
		const here = `${origin}/cursos/${params.courseSlug}/clases/${params.lessonSlug}`;
		return (
			<main data-page="lesson-locked">
				<h1>Ingresá para ver esta clase</h1>
				<a href={`${appOrigin}/login?return=${encodeURIComponent(here)}`}>
					Ingresar
				</a>
			</main>
		);
	}
	if (data.kind === "enroll") {
		return (
			<main data-page="lesson-locked">
				<h1>Necesitás estar inscripto</h1>
				<p>Esta clase es parte de {data.course.name}.</p>
				<Link
					to="/cursos/$courseSlug"
					params={{ courseSlug: data.course.slug }}
				>
					Ver el curso
				</Link>
			</main>
		);
	}
	if (data.kind !== "ok") return null;

	return (
		<LessonPage
			data={data}
			pending={pending}
			viewerEmail={user?.email ?? ""}
			onComplete={async () => {
				setPending(true);
				await completeLesson({ data: params });
				await router.invalidate();
				setPending(false);
			}}
		>
			{comments && (
				<CommentsSection
					data={comments}
					pending={pending}
					message={commentMessage}
					onPost={async (values) => {
						setPending(true);
						const result = await postComment({
							data: { ...params, ...values },
						});
						setPending(false);
						setCommentMessage(result.ok ? undefined : result.message);
						if (result.ok) await router.invalidate();
					}}
					onHide={async (commentId, hidden) => {
						setPending(true);
						await setCommentVisibility({ data: { commentId, hidden } });
						setPending(false);
						await router.invalidate();
					}}
				/>
			)}
		</LessonPage>
	);
}
