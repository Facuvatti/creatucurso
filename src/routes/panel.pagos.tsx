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
	disconnectMercadoPago,
	getPaymentsPanel,
	refundAcademyPayment,
	startMercadoPagoConnection,
} from "../server/payments.functions.ts";

// What the OAuth callback tells the panel through ?mp=...
const FLASH: Record<string, string> = {
	connected: "Mercado Pago conectado. Ya podés cobrar con tu cuenta.",
	expired:
		"El enlace de conexión venció o ya se usó. Volvé a conectar Mercado Pago.",
	session:
		"Tu sesión no coincide con la de quien inició la conexión. Ingresá de nuevo y volvé a intentarlo.",
	role: "Solo el dueño o un administrador puede conectar Mercado Pago.",
	exchange:
		"Mercado Pago no aceptó la conexión. Volvé a intentarlo en unos minutos.",
	duplicate: "Esa cuenta de Mercado Pago ya está conectada a otra academia.",
	save: "No pudimos guardar la conexión. Volvé a intentarlo.",
};

export const Route = createFileRoute("/panel/pagos")({
	validateSearch: (search: Record<string, unknown>): { mp?: string } =>
		typeof search.mp === "string" && search.mp in FLASH
			? { mp: search.mp }
			: {},
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
	const { mp } = Route.useSearch();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | undefined>(
		mp ? FLASH[mp] : undefined,
	);

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
			onDisconnectMercadoPago={() => {
				if (
					!window.confirm(
						"¿Desconectar Mercado Pago? No vas a poder cobrar hasta reconectar.",
					)
				)
					return;
				run(() => disconnectMercadoPago(), "Mercado Pago desconectado.");
			}}
			onActivate={() =>
				run(() => activateAcademyPayments(), "Cobros activados.")
			}
			onConnect={(values) =>
				run(
					() => connectPaymentProvider({ data: values }),
					"Proveedor conectado.",
				)
			}
			onConnectMercadoPago={async () => {
				setPending(true);
				const result = await startMercadoPagoConnection();
				if (result.ok) {
					// Leaves for Mercado Pago, which sends the owner back to the callback.
					window.location.assign(result.url);
					return;
				}
				setMessage(result.message);
				setPending(false);
			}}
			onRefund={(paymentId, amount) => {
				if (!window.confirm("¿Confirmás el reembolso? No se puede deshacer."))
					return;
				run(
					() => refundAcademyPayment({ data: { paymentId, amount } }),
					"Reembolso realizado.",
				);
			}}
		/>
	);
}
