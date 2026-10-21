import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { can } from "../areas/identity/permissions.ts";
import { AutomationsPage } from "../components/pages/automations-page.tsx";
import { getAutomationsPanel } from "../server/automations.functions.ts";

// What the OAuth callback tells the panel through ?gmail=...
const FLASH: Record<string, string> = {
	connected: "Gmail conectado. Los mails se envían desde tu cuenta.",
	expired: "El enlace de conexión venció o ya se usó. Volvé a conectar Gmail.",
	session:
		"Tu sesión no coincide con la de quien inició la conexión. Ingresá de nuevo y volvé a intentarlo.",
	role: "Solo el dueño o un administrador puede conectar Gmail.",
	denied: "No autorizaste la conexión con Gmail.",
	scope:
		"Hay que aceptar el permiso para enviar mails. Volvé a conectar y dejá esa casilla marcada.",
	exchange: "Google no aceptó la conexión. Volvé a intentarlo en unos minutos.",
	save: "No pudimos guardar la conexión. Volvé a intentarlo.",
};

export const Route = createFileRoute("/panel/automatizaciones")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): { gmail?: string } =>
		typeof search.gmail === "string" && search.gmail in FLASH
			? { gmail: search.gmail }
			: {},
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
	const { gmail } = Route.useSearch();
	return (
		<AutomationsPage
			panel={panel}
			flash={gmail ? FLASH[gmail] : undefined}
			onChanged={() => router.invalidate()}
		/>
	);
}
