import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { can } from "../areas/identity/permissions.ts";
import { MessagesPage } from "../components/pages/messages-page.tsx";
import { getChatOverview } from "../server/chat.functions.ts";

type Search = { curso?: string; con?: string };

export const Route = createFileRoute("/mensajes")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): Search =>
		typeof search.curso === "string" && typeof search.con === "string"
			? { curso: search.curso, con: search.con }
			: {},
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/mensajes`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		// Students, tutors and staff of this academy (members with the chat permission).
		if (!can(context.roles, { chat: ["participate"] })) throw notFound();
	},
	loader: () => getChatOverview(),
	head: () => ({ meta: [{ title: "Mensajes" }] }),
	component: MessagesRoute,
});

function MessagesRoute() {
	const overview = Route.useLoaderData();
	const { roles } = Route.useRouteContext();
	const { curso, con } = Route.useSearch();
	return (
		<MessagesPage
			overview={overview}
			isStaff={can(roles, { course: ["update"] })}
			start={curso && con ? { courseId: curso, userId: con } : undefined}
		/>
	);
}
