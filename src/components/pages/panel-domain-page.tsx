import { Link } from "@tanstack/react-router";
import type { DomainState } from "../../server/domain.functions.ts";

type Props = {
	state: DomainState;
	message?: string | undefined;
	pending: boolean;
	onSave: (domain: string) => void;
	onVerify: () => void;
	onRemove: () => void;
};

export function PanelDomainPage({
	state,
	message,
	pending,
	onSave,
	onVerify,
	onRemove,
}: Props) {
	return (
		<main data-page="panel-domain">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>Dominio propio</h1>
			{message && <output>{message}</output>}

			{state.domain && state.verified && (
				<p>
					<strong>{state.domain}</strong> está verificado. Apuntalo con un
					registro CNAME a esta plataforma.
				</p>
			)}

			{state.domain && !state.verified && state.txtName && (
				<section>
					<p>
						Para demostrar que <strong>{state.domain}</strong> es tuyo, creá
						este registro DNS TXT:
					</p>
					<dl>
						<dt>Nombre</dt>
						<dd>
							<code>{state.txtName}</code>
						</dd>
						<dt>Valor</dt>
						<dd>
							<code>{state.txtValue}</code>
						</dd>
					</dl>
					<button type="button" disabled={pending} onClick={onVerify}>
						Verificar
					</button>
				</section>
			)}

			{state.domain && (
				<p>
					<button type="button" disabled={pending} onClick={onRemove}>
						Quitar dominio
					</button>
				</p>
			)}

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
		</main>
	);
}
