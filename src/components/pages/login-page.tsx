export type LoginValues = { name: string; email: string; password: string };

type Props = {
	mode: "signin" | "signup";
	error?: string | undefined;
	pending: boolean;
	onToggleMode: () => void;
	onSubmit: (values: LoginValues) => void;
};

export function LoginPage({
	mode,
	error,
	pending,
	onToggleMode,
	onSubmit,
}: Props) {
	const signingUp = mode === "signup";

	return (
		<main data-page="login">
			<h1>{signingUp ? "Crear cuenta" : "Ingresar"}</h1>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					onSubmit({
						name: String(data.get("name") ?? ""),
						email: String(data.get("email") ?? ""),
						password: String(data.get("password") ?? ""),
					});
				}}
			>
				{signingUp && (
					<label>
						Nombre
						<input name="name" required autoComplete="name" />
					</label>
				)}
				<label>
					Email
					<input name="email" type="email" required autoComplete="email" />
				</label>
				<label>
					Contraseña
					<input
						name="password"
						type="password"
						required
						minLength={8}
						autoComplete={signingUp ? "new-password" : "current-password"}
					/>
				</label>
				{error && <p role="alert">{error}</p>}
				<button type="submit" disabled={pending}>
					{signingUp ? "Crear cuenta" : "Ingresar"}
				</button>
			</form>
			<button type="button" onClick={onToggleMode}>
				{signingUp ? "Ya tengo cuenta" : "Quiero crear una cuenta"}
			</button>
		</main>
	);
}
