import { Link } from "@tanstack/react-router";
import type { PaymentsPanel } from "../../server/payments.functions.ts";

type Props = {
	panel: PaymentsPanel;
	message?: string | undefined;
	pending: boolean;
	onActivate: () => void;
	onConnect: (values: { connectorName: string; apiKey: string }) => void;
};

const PROVIDERS = [
	{ value: "mercadopago", label: "Mercado Pago" },
	{ value: "stripe", label: "Stripe" },
	{ value: "dlocal", label: "dLocal" },
];

export function PaymentsPanelPage({
	panel,
	message,
	pending,
	onActivate,
	onConnect,
}: Props) {
	return (
		<main data-page="payments-panel">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>Cobros</h1>

			{!panel.available ? (
				<p>Los cobros todavía no están disponibles en esta instalación.</p>
			) : !panel.active ? (
				<section>
					<p>
						Activá los cobros para vender tus cursos. El dinero de cada venta va
						directo a tu cuenta del proveedor de pagos.
					</p>
					<button type="button" onClick={onActivate} disabled={pending}>
						Activar cobros
					</button>
				</section>
			) : (
				<section>
					<p data-status="active">Los cobros están activados.</p>
					<h2>Conectar un proveedor de pagos</h2>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							onConnect({
								connectorName: String(data.get("connectorName") ?? ""),
								apiKey: String(data.get("apiKey") ?? ""),
							});
						}}
					>
						<label>
							Proveedor
							<select name="connectorName">
								{PROVIDERS.map((provider) => (
									<option key={provider.value} value={provider.value}>
										{provider.label}
									</option>
								))}
								{panel.testConnectors && (
									<option value="fauxpay">Prueba (solo desarrollo)</option>
								)}
							</select>
						</label>
						<label>
							Clave de acceso (access token)
							<input name="apiKey" type="password" required minLength={8} />
						</label>
						<button type="submit" disabled={pending}>
							Conectar
						</button>
					</form>
				</section>
			)}
			{message && <output>{message}</output>}
		</main>
	);
}
