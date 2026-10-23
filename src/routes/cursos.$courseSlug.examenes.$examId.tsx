import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ExamPage } from "../components/pages/exam-page.tsx";
import { getExamPage } from "../server/exams.functions.ts";

export const Route = createFileRoute("/cursos/$courseSlug/examenes/$examId")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
	},
	loader: async ({ params }) => {
		const page = await getExamPage({ data: params });
		if (page.kind === "notFound") throw notFound();
		return { page };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title:
					loaderData?.page.kind === "ok"
						? `${loaderData.page.exam.title} | ${loaderData.page.course.name}`
						: "Examen",
			},
		],
	}),
	component: ExamRoute,
});

function ExamRoute() {
	const { page } = Route.useLoaderData();
	const params = Route.useParams();
	const { origin, appOrigin } = Route.useRouteContext();

	if (page.kind === "login") {
		const here = `${origin}/cursos/${params.courseSlug}/examenes/${params.examId}`;
		return (
			<main data-page="exam-locked">
				<h1>Ingresá para rendir este examen</h1>
				<div data-actions>
					<a
						href={`${appOrigin}/login?return=${encodeURIComponent(here)}`}
						data-cta="primary"
					>
						Ingresar
					</a>
				</div>
			</main>
		);
	}
	if (page.kind === "enroll") {
		return (
			<main data-page="exam-locked">
				<h1>Necesitás estar inscripto</h1>
				<p>Este examen es parte de {page.course.name}.</p>
				<div data-actions>
					<Link
						to="/cursos/$courseSlug"
						params={{ courseSlug: page.course.slug }}
						data-cta="primary"
					>
						Ver el curso
					</Link>
				</div>
			</main>
		);
	}
	if (page.kind !== "ok") return null;
	return <ExamPage data={page} />;
}
