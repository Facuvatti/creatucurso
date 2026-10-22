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
	connectDomain,
	type DomainResult,
	deleteDomain,
	getDomainPanel,
	saveDomain,
} from "../server/domain.functions.ts";

/** Messages after the DNS provider sends the owner back (Domain Connect). */
const FLASH: Record<string, string> = {
	ok: "Tu proveedor aplicó el registro. Ya estamos preparando el certificado.",
	pendiente:
		"Tu proveedor recibió el cambio. Puede tardar unos minutos en verse; lo seguimos verificando solos.",
	cancelado:
		"Cancelaste la conexión en tu proveedor. Podés intentarlo de nuevo.",
	error:
		"Tu proveedor no pudo aplicar el registro. Intentá de nuevo o crealo a mano.",
};

export const Route = createFileRoute("/panel/dominio")({
	validateSearch: (search: Record<string, unknown>): { conexion?: string } =>
		typeof search.conexion === "string" && search.conexion in FLASH
			? { conexion: search.conexion }
			: {},
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
	const { conexion } = Route.useSearch();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | undefined>(
		conexion ? FLASH[conexion] : undefined,
	);

	async function connect() {
		setPending(true);
		const result = await connectDomain();
		if (result.ok) {
			window.location.assign(result.url);
			return;
		}
		setMessage(result.message);
		setPending(false);
	}

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
			onVerify={() => run(() => checkDomain(), "Estado actualizado.")}
			onConnect={connect}
			onRemove={() => run(() => deleteDomain(), "Dominio quitado.")}
		/>
	);
}
