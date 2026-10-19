import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { CoursePage } from "../components/pages/course-page.tsx";
import { getCoursePage } from "../server/catalog.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const result = await getCoursePage({
			data: { courseSlug: params.courseSlug },
		});
		if (result.kind === "notFound") throw notFound();
		if (result.kind === "moved") {
			throw redirect({
				to: "/cursos/$courseSlug",
				params: { courseSlug: result.slug },
				statusCode: 301,
			});
		}
		return result;
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: loaderData?.course.name ?? "Curso" },
			...(loaderData?.course.shortDescription
				? [{ name: "description", content: loaderData.course.shortDescription }]
				: []),
		],
	}),
	component: CourseRoute,
});

function CourseRoute() {
	const { course, access, completedLessonIds } = Route.useLoaderData();
	const { origin, appOrigin } = Route.useRouteContext();
	const here = `${origin}/cursos/${course.slug}`;
	const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(here)}`;

	return (
		<CoursePage
			course={course}
			access={access}
			completedLessonIds={completedLessonIds}
			loginUrl={loginUrl}
		/>
	);
}
