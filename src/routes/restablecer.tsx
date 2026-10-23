import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/restablecer")({
	validateSearch: (search: Record<string, unknown>): { token?: string } =>
		typeof search.token === "string" ? { token: search.token } : {},
	beforeLoad: ({ context }) => {
		if (context.host.kind !== "platform-app") throw notFound();
	},
	head: () => ({ meta: [{ title: "Nueva contraseña | Creatucurso" }] }),
	component: ResetRoute,
});

function ResetRoute() {
	const { token } = Route.useSearch();
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	if (!token) {
		return (
			<main data-page="reset">
				<h1>Enlace inválido</h1>
				<p>El enlace venció o no es válido.</p>
				<div data-actions>
					<a href="/recuperar" data-cta="primary">
						Pedí uno nuevo
					</a>
				</div>
			</main>
		);
	}

	if (done) {
		return (
			<main data-page="reset">
				<h1>Contraseña actualizada</h1>
				<div data-actions>
					<a href="/login" data-cta="primary">
						Ingresar
					</a>
				</div>
			</main>
		);
	}

	return (
		<main data-page="reset">
			<h1>Elegí una contraseña nueva</h1>
			<form
				method="post"
				onSubmit={async (event) => {
					event.preventDefault();
					setPending(true);
					setError(undefined);
					const newPassword = String(
						new FormData(event.currentTarget).get("password"),
					);
					const result = await authClient.resetPassword({ newPassword, token });
					setPending(false);
					if (result.error) {
						setError(
							result.error.message ?? "No pudimos cambiar la contraseña.",
						);
						return;
					}
					setDone(true);
				}}
			>
				<label>
					Contraseña nueva
					<input
						name="password"
						type="password"
						required
						minLength={8}
						autoComplete="new-password"
					/>
				</label>
				{error && <p role="alert">{error}</p>}
				<button type="submit" disabled={pending}>
					Guardar contraseña
				</button>
			</form>
		</main>
	);
}
