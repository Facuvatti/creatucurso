import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { CoursePage } from "../components/pages/course-page.tsx";
import { getCoursePage } from "../server/catalog.functions.ts";
import { enrollInFreeCourse } from "../server/payments.functions.ts";

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
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();
	const here = `${origin}/cursos/${course.slug}`;
	const loginUrl = `${appOrigin}/login?return=${encodeURIComponent(here)}`;

	return (
		<CoursePage
			course={course}
			access={access}
			completedLessonIds={completedLessonIds}
			loginUrl={loginUrl}
			pending={pending}
			message={message}
			onEnrollFree={async () => {
				setPending(true);
				const result = await enrollInFreeCourse({
					data: { courseSlug: course.slug },
				});
				setPending(false);
				if (!result.ok) return setMessage(result.message);
				await router.invalidate();
			}}
		/>
	);
}
