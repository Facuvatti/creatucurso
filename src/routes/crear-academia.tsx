import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { CreateAcademyPage } from "../components/pages/create-academy-page.tsx";
import { createAcademy } from "../server/academy.functions.ts";

export const Route = createFileRoute("/crear-academia")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "platform-app") throw notFound();
		if (!context.user) throw redirect({ to: "/login", search: {} });
	},
	head: () => ({ meta: [{ title: "Crear mi academia | Creatucurso" }] }),
	component: CreateAcademyRoute,
});

function CreateAcademyRoute() {
	const { appOrigin } = Route.useRouteContext();
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const domainSuffix = new URL(appOrigin).host.replace(/^app\./, "");

	async function submit(values: { name: string; slug: string }) {
		setPending(true);
		setError(undefined);
		const result = await createAcademy({ data: values });
		if (!result.ok) {
			setError(result.message);
			setPending(false);
			return;
		}
		window.location.assign(`/handoff?return=${encodeURIComponent(result.url)}`);
	}

	return (
		<CreateAcademyPage
			error={error}
			pending={pending}
			domainSuffix={domainSuffix}
			onSubmit={submit}
		/>
	);
}
