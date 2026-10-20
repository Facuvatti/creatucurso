import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { can } from "../areas/identity/permissions.ts";
import { PaymentsPanelPage } from "../components/pages/payments-panel-page.tsx";
import {
	activateAcademyPayments,
	connectPaymentProvider,
	getPaymentsPanel,
} from "../server/payments.functions.ts";

export const Route = createFileRoute("/panel/pagos")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "tenant") throw notFound();
		if (!context.user) {
			const here = `${context.origin}/panel/pagos`;
			throw redirect({
				href: `${context.appOrigin}/login?return=${encodeURIComponent(here)}`,
			});
		}
		if (!can(context.roles, { billing: ["manage"] })) throw notFound();
	},
	loader: () => getPaymentsPanel(),
	head: () => ({ meta: [{ title: "Cobros | Panel" }] }),
	component: PaymentsRoute,
});

function PaymentsRoute() {
	const panel = Route.useLoaderData();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string>();

	async function run(
		action: () => Promise<{ ok: true } | { ok: false; message: string }>,
		success: string,
	) {
		setPending(true);
		const result = await action();
		setMessage(result.ok ? success : result.message);
		if (result.ok) await router.invalidate();
		setPending(false);
	}

	return (
		<PaymentsPanelPage
			panel={panel}
			message={message}
			pending={pending}
			onActivate={() =>
				run(() => activateAcademyPayments(), "Cobros activados.")
			}
			onConnect={(values) =>
				run(
					() => connectPaymentProvider({ data: values }),
					"Proveedor conectado.",
				)
			}
		/>
	);
}
