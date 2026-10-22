import { Link } from "@tanstack/react-router";
import type { DomainPanel } from "../../server/domain.functions.ts";

type Props = {
	state: DomainPanel;
	message?: string | undefined;
	pending: boolean;
	onSave: (domain: string) => void;
	onVerify: () => void;
	onConnect: () => void;
	onRemove: () => void;
};

const STATUS_LABEL = {
	pending_dns: "Pendiente de DNS",
	issuing_certificate: "Emitiendo certificado",
	active: "Activo",
	error: "Error",
} as const;

export function PanelDomainPage({
	state,
	message,
	pending,
	onSave,
	onVerify,
	onConnect,
	onRemove,
}: Props) {
	return (
		<main data-page="panel-domain">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>Dominio propio</h1>
			{message && <output>{message}</output>}

			{!state.enabled && !state.domain && (
				<p>Los dominios propios no están habilitados en esta plataforma.</p>
			)}

			{state.domain && state.status && (
				<section>
					<p>
						<strong>{state.domain}</strong>: {STATUS_LABEL[state.status]}
					</p>
					{state.reason && <p>{state.reason}</p>}

					{state.status === "active" ? (
						<p>Tu dominio ya funciona.</p>
					) : (
						<>
							{state.connectProvider ? (
								<>
									<p>
										Tu dominio está en {state.connectProvider}. Podés conectarlo
										sin tocar el DNS: solo tenés que autorizar el cambio.
									</p>
									<p>
										<button
											type="button"
											disabled={pending}
											onClick={onConnect}
										>
											Conectar automáticamente con {state.connectProvider}
										</button>
									</p>
									<p>Si preferís hacerlo a mano, creá este registro DNS:</p>
								</>
							) : (
								<p>
									En el sitio donde compraste el dominio, creá este registro
									DNS. Es el único paso; el resto es automático.
								</p>
							)}
							<dl>
								<dt>Tipo</dt>
								<dd>
									<code>CNAME</code>
								</dd>
								<dt>Nombre</dt>
								<dd>
									<code>{state.cnameName}</code>
								</dd>
								<dt>Valor</dt>
								<dd>
									<code>{state.cnameTarget}</code>
								</dd>
							</dl>
							<button type="button" disabled={pending} onClick={onVerify}>
								Verificar ahora
							</button>
						</>
					)}
					<p>
						<button type="button" disabled={pending} onClick={onRemove}>
							Quitar dominio
						</button>
					</p>
				</section>
			)}

			{state.enabled && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = event.currentTarget;
						onSave(String(new FormData(form).get("domain") ?? ""));
						form.reset();
					}}
				>
					<label>
						{state.domain ? "Cambiar dominio" : "Tu dominio"}
						<input name="domain" placeholder="cursos.tudominio.com" required />
					</label>
					<button type="submit" disabled={pending}>
						Guardar
					</button>
				</form>
			)}
		</main>
	);
}
