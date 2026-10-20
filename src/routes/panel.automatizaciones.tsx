import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { can } from "../areas/identity/permissions.ts";
import { AutomationsPage } from "../components/pages/automations-page.tsx";
import { getAutomationsPanel } from "../server/automations.functions.ts";

export const Route = createFileRoute("/panel/automatizaciones")({
	ssr: false,
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/automatizaciones`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		if (!can(context.roles, { course: ["update"] })) throw notFound();
	},
	loader: () => getAutomationsPanel(),
	head: () => ({ meta: [{ title: "Automatizaciones | Panel" }] }),
	component: AutomationsRoute,
});

function AutomationsRoute() {
	const panel = Route.useLoaderData();
	const router = useRouter();
	return (
		<AutomationsPage panel={panel} onChanged={() => router.invalidate()} />
	);
}
