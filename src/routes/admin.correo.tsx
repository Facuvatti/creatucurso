import {
	createFileRoute,
	notFound,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import {
	disconnectPlatformGmail,
	getPlatformMail,
	startPlatformGmail,
} from "../server/gmail.functions.ts";

// What the OAuth callback tells the page through ?gmail=...
const FLASH: Record<string, string> = {
	connected:
		"Gmail conectado. Los mails de la plataforma salen desde esa cuenta.",
	expired: "El enlace de conexión venció o ya se usó. Volvé a conectar Gmail.",
	session: "Tu sesión no coincide con la de quien inició la conexión.",
	role: "Solo el administrador de la plataforma puede conectar este correo.",
	denied: "No autorizaste la conexión con Gmail.",
	scope: "Hay que aceptar el permiso para enviar mails. Volvé a intentarlo.",
	exchange: "Google no aceptó la conexión. Volvé a intentarlo en unos minutos.",
	save: "No pudimos guardar la conexión. Volvé a intentarlo.",
};

export const Route = createFileRoute("/admin/correo")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): { gmail?: string } =>
		typeof search.gmail === "string" && search.gmail in FLASH
			? { gmail: search.gmail }
			: {},
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "platform-app") throw notFound();
		if (!context.user) throw redirect({ to: "/login", search: {} });
	},
	// The server allows only PLATFORM_ADMIN_EMAIL; everyone else gets "not found".
	loader: () =>
		getPlatformMail().catch(() => {
			throw notFound();
		}),
	head: () => ({ meta: [{ title: "Correo de la plataforma | Creatucurso" }] }),
	component: PlatformMailRoute,
});

function PlatformMailRoute() {
	const mail = Route.useLoaderData();
	const router = useRouter();
	const { gmail } = Route.useSearch();
	const [message, setMessage] = useState<string | undefined>(
		gmail ? FLASH[gmail] : undefined,
	);
	const [pending, setPending] = useState(false);

	async function connect() {
		setPending(true);
		const result = await startPlatformGmail();
		if (result.ok) {
			window.location.assign(result.url);
			return;
		}
		setMessage(result.message);
		setPending(false);
	}

	async function remove() {
		if (!window.confirm("¿Desconectar el Gmail de la plataforma?")) return;
		setPending(true);
		await disconnectPlatformGmail();
		setMessage("Gmail desconectado.");
		await router.invalidate();
		setPending(false);
	}

	return (
		<main data-page="platform-mail">
			<h1>Correo de la plataforma</h1>
			<p>
				Desde esta cuenta de Gmail salen los mails de verificación, de
				recuperación de contraseña y los avisos.
			</p>
			{message && <output>{message}</output>}
			{!mail.available && (
				<p data-status="warning">
					Falta configurar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y
					SECRETS_ENCRYPTION_KEY.
				</p>
			)}
			{mail.status === "connected" && (
				<p data-status="connected">Conectado como {mail.email}.</p>
			)}
			{mail.status === "error" && (
				<p data-status="warning">
					Conectado como {mail.email}, pero Gmail dio un error. Lo vamos a
					reintentar; si el aviso sigue, reconectá la cuenta.
				</p>
			)}
			{mail.status === "disconnected" && (
				<p data-status="disconnected" role="alert">
					<strong>El Gmail de la plataforma está desconectado.</strong> Mientras
					tanto los mails se escriben en el registro del servidor.
				</p>
			)}
			{mail.status === null && (
				<p>
					Todavía no conectaste un Gmail. Hasta entonces los mails no se envían.
				</p>
			)}
			{mail.status !== "connected" && (
				<button
					type="button"
					onClick={connect}
					disabled={pending || !mail.available}
				>
					{mail.status === null ? "Conectar Gmail" : "Reconectar Gmail"}
				</button>
			)}{" "}
			{mail.status !== null && mail.status !== "disconnected" && (
				<button type="button" onClick={remove} disabled={pending}>
					Desconectar
				</button>
			)}
		</main>
	);
}
