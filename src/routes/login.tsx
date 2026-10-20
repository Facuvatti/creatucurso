import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
	LoginPage,
	type LoginValues,
} from "../components/pages/login-page.tsx";
import { authClient } from "../lib/auth-client.ts";

const handoffPath = (returnUrl: string | undefined) =>
	`/handoff${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ""}`;

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { return?: string } =>
		typeof search.return === "string" ? { return: search.return } : {},
	beforeLoad: ({ context, search }) => {
		if (context.host.kind !== "platform-app") throw notFound();
		if (context.user) throw redirect({ href: handoffPath(search.return) });
	},
	head: () => ({ meta: [{ title: "Ingresar | Creatucurso" }] }),
	component: LoginRoute,
});

function LoginRoute() {
	const { return: returnUrl } = Route.useSearch();
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);

	async function submit(values: LoginValues) {
		setPending(true);
		setError(undefined);
		const result =
			mode === "signin"
				? await authClient.signIn.email({
						email: values.email,
						password: values.password,
					})
				: await authClient.signUp.email({
						name: values.name,
						email: values.email,
						password: values.password,
					});
		if (result.error) {
			setError(result.error.message ?? "No pudimos completar la operación.");
			setPending(false);
			return;
		}
		window.location.assign(handoffPath(returnUrl));
	}

	return (
		<LoginPage
			mode={mode}
			error={error}
			pending={pending}
			onToggleMode={() => setMode(mode === "signin" ? "signup" : "signin")}
			onSubmit={submit}
		/>
	);
}
