import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { PanelCoursePage } from "../components/pages/panel-course-page.tsx";
import { can } from "../modules/identity/domain/can.ts";
import {
	type ActionResult,
	addLesson,
	addModule,
	enrollStudentByEmail,
	getPanelCourse,
	setCourseStatus,
} from "../server/catalog.functions.ts";
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
		return course;
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.name ?? "Curso"} | Panel` }],
	}),
	component: PanelCourseRoute,
});

function PanelCourseRoute() {
	const course = Route.useLoaderData();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();

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
			message={message}
			pending={pending}
			onStatus={(status) =>
				run(
					() => setCourseStatus({ data: { courseId: course.id, status } }),
					status === "published"
						? "Curso publicado."
						: "El curso volvió a borrador.",
				)
			}
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
		/>
	);
}
