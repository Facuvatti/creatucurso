import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/recuperar")({
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "platform-app") throw notFound();
	},
	head: () => ({ meta: [{ title: "Recuperar contraseña | Creatucurso" }] }),
	component: RecoverRoute,
});

function RecoverRoute() {
	const { appOrigin } = Route.useRouteContext();
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	return (
		<main data-page="recover">
			<h1>Recuperar contraseña</h1>
			{sent ? (
				<p>
					Si hay una cuenta con ese email, te enviamos un enlace para elegir una
					contraseña nueva.
				</p>
			) : (
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						setPending(true);
						setError(undefined);
						const email = String(
							new FormData(event.currentTarget).get("email"),
						);
						const result = await authClient.requestPasswordReset({
							email,
							redirectTo: `${appOrigin}/restablecer`,
						});
						setPending(false);
						if (result.error) {
							setError(result.error.message ?? "No pudimos enviar el email.");
							return;
						}
						setSent(true);
					}}
				>
					<label>
						Email
						<input name="email" type="email" required autoComplete="email" />
					</label>
					{error && <p role="alert">{error}</p>}
					<button type="submit" disabled={pending}>
						Enviar enlace
					</button>
				</form>
			)}
			<p>
				<a href="/login">Volver a ingresar</a>
			</p>
		</main>
	);
}
