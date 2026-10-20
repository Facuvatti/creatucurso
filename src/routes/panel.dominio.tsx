import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { PanelDomainPage } from "../components/pages/panel-domain-page.tsx";
import {
	checkDomain,
	type DomainResult,
	deleteDomain,
	getDomainPanel,
	saveDomain,
} from "../server/domain.functions.ts";

export const Route = createFileRoute("/panel/dominio")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/dominio`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		if (!context.roles.includes("owner")) throw notFound();
	},
	loader: () => getDomainPanel(),
	head: () => ({ meta: [{ title: "Dominio propio | Panel" }] }),
	component: DomainRoute,
});

function DomainRoute() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();

	async function run(action: () => Promise<DomainResult>, success: string) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		if (result.ok) await router.invalidate();
		setPending(false);
	}

	return (
		<PanelDomainPage
			state={state}
			message={message}
			pending={pending}
			onSave={(domain) =>
				run(() => saveDomain({ data: { domain } }), "Dominio guardado.")
			}
			onVerify={() => run(() => checkDomain(), "Dominio verificado.")}
			onRemove={() => run(() => deleteDomain(), "Dominio quitado.")}
		/>
	);
}
