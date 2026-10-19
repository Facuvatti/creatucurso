import {
	createFileRoute,
	Link,
	notFound,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { LessonPage } from "../components/pages/lesson-page.tsx";
import { completeLesson, getLessonPage } from "../server/catalog.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/clases/$lessonSlug")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const result = await getLessonPage({ data: params });
		if (result.kind === "notFound") throw notFound();
		return result;
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title:
					loaderData?.kind === "ok"
						? `${loaderData.lesson.title} | ${loaderData.course.name}`
						: "Clase",
			},
		],
	}),
	component: LessonRoute,
});

function LessonRoute() {
	const data = Route.useLoaderData();
	const params = Route.useParams();
	const { origin, appOrigin } = Route.useRouteContext();
	const router = useRouter();
	const [pending, setPending] = useState(false);

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
			onComplete={async () => {
				setPending(true);
				await completeLesson({ data: params });
				await router.invalidate();
				setPending(false);
			}}
		/>
	);
}
