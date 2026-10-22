import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { can } from "../areas/identity/permissions.ts";
import { BillingPanelPage } from "../components/pages/billing-panel-page.tsx";
import {
	chooseBillingPlan,
	getBillingPanel,
	startBillingSubscription,
} from "../server/billing.functions.ts";

// What the panel says when Mercado Pago sends the owner back (?mp=vuelta).
const FLASH: Record<string, string> = {
	vuelta:
		"Volviste de Mercado Pago. Cuando Mercado Pago confirme la suscripción, el estado se actualiza acá.",
};

export const Route = createFileRoute("/panel/facturacion")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): { mp?: string } =>
		typeof search.mp === "string" && search.mp in FLASH
			? { mp: search.mp }
			: {},
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/facturacion`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		if (!can(context.roles, { billing: ["manage"] })) throw notFound();
	},
	loader: () => getBillingPanel(),
	head: () => ({ meta: [{ title: "Facturación | Panel" }] }),
	component: BillingRoute,
});

function BillingRoute() {
	const panel = Route.useLoaderData();
	const { mp } = Route.useSearch();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | undefined>(
		mp ? FLASH[mp] : undefined,
	);

	return (
		<BillingPanelPage
			panel={panel}
			message={message}
			pending={pending}
			onSubscribe={async (payerEmail) => {
				setPending(true);
				const result = await startBillingSubscription({ data: { payerEmail } });
				if (result.ok) {
					// Leaves for Mercado Pago, which sends the owner back to this page.
					window.location.assign(result.url);
					return;
				}
				setMessage(result.message);
				setPending(false);
			}}
			onChoosePlan={async (plan) => {
				setPending(true);
				const result = await chooseBillingPlan({ data: { plan } });
				setMessage(result.ok ? "Plan actualizado." : result.message);
				if (result.ok) await router.invalidate();
				setPending(false);
			}}
		/>
	);
}
