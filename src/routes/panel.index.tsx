import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import {
	type ImportOutcome,
	PanelPage,
} from "../components/pages/panel-page.tsx";
import { can } from "../modules/identity/domain/can.ts";
import {
	createBasicCourse,
	getPanelCourses,
	importCourseJson,
} from "../server/catalog.functions.ts";

export const Route = createFileRoute("/panel/")({
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
	loader: () => getPanelCourses(),
	head: () => ({ meta: [{ title: "Panel de la academia" }] }),
	component: PanelRoute,
});

function PanelRoute() {
	const courses = Route.useLoaderData();
	const router = useRouter();
	const navigate = Route.useNavigate();
	const [pending, setPending] = useState(false);
	const [createError, setCreateError] = useState<string>();
	const [outcome, setOutcome] = useState<ImportOutcome>({ kind: "idle" });

	return (
		<PanelPage
			courses={courses}
			createError={createError}
			importOutcome={outcome}
			pending={pending}
			onCreate={async (values) => {
				setPending(true);
				setCreateError(undefined);
				const result = await createBasicCourse({ data: values });
				setPending(false);
				if (!result.ok) return setCreateError(result.message);
				if (result.courseId) {
					await navigate({
						to: "/panel/cursos/$courseId",
						params: { courseId: result.courseId },
					});
				}
			}}
			onImport={async (json) => {
				setPending(true);
				const result = await importCourseJson({ data: { json } });
				setPending(false);
				if (result.ok) {
					setOutcome({
						kind: "done",
						courseId: result.courseId,
						uploadSlots: result.uploadSlots,
					});
					await router.invalidate();
				} else {
					setOutcome({ kind: "errors", errors: result.errors });
				}
			}}
		/>
	);
}
