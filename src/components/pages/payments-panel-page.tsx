import { Link } from "@tanstack/react-router";
import type { PaymentsPanel } from "../../server/payments.functions.ts";
import { formatMoney } from "../../shared/money.ts";

type Props = {
	panel: PaymentsPanel;
	message?: string | undefined;
	pending: boolean;
	onActivate: () => void;
	onConnect: (values: { connectorName: string; apiKey: string }) => void;
	onConnectMercadoPago: (values: {
		accessToken: string;
		webhookSecret: string;
	}) => void;
	/** `amount` in major units, or null for a full refund. */
	onRefund: (paymentId: string, amount: number | null) => void;
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
	onConnectMercadoPago,
	onRefund,
}: Props) {
	return (
		<main data-page="payments-panel">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>Cobros</h1>

			<section>
				<h2>Mercado Pago (directo)</h2>
				{panel.provider === "mercadopago" && (
					<p data-status="active">
						Cobrás con Mercado Pago. El dinero va directo a tu cuenta.
					</p>
				)}
				{!panel.mercadoPagoAvailable ? (
					<p>Mercado Pago todavía no está disponible en esta instalación.</p>
				) : (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							onConnectMercadoPago({
								accessToken: String(data.get("accessToken") ?? ""),
								webhookSecret: String(data.get("webhookSecret") ?? ""),
							});
							event.currentTarget.reset();
						}}
					>
						<p>
							En tu cuenta de Mercado Pago, creá una aplicación, copiá el access
							token y configurá las notificaciones (evento Pagos y Contracargos)
							con esta URL: <code>{panel.mercadoPagoWebhookUrl}</code>. Pegá acá
							también la clave secreta de esas notificaciones. Las credenciales
							se guardan cifradas y no se vuelven a mostrar.
						</p>
						<label>
							Access token
							<input
								name="accessToken"
								type="password"
								required
								minLength={20}
								autoComplete="off"
							/>
						</label>
						<label>
							Clave secreta de las notificaciones
							<input
								name="webhookSecret"
								type="password"
								required
								minLength={8}
								autoComplete="off"
							/>
						</label>
						<button type="submit" disabled={pending}>
							{panel.provider === "mercadopago"
								? "Actualizar credenciales"
								: "Usar Mercado Pago"}
						</button>
					</form>
				)}
			</section>

			<h2>Otros proveedores (Hyperswitch)</h2>
			{!panel.available ? (
				<p>Esta opción todavía no está disponible en esta instalación.</p>
			) : panel.provider !== "hyperswitch" ? (
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

			{panel.payments.length > 0 && (
				<section>
					<h2>Pagos</h2>
					<table>
						<thead>
							<tr>
								<th>Fecha</th>
								<th>Curso</th>
								<th>Alumno</th>
								<th>Monto</th>
								<th>Reembolsado</th>
								<th>Reembolsar</th>
							</tr>
						</thead>
						<tbody>
							{panel.payments.map((payment) => (
								<tr key={payment.id}>
									<td>
										{new Date(payment.createdAt).toLocaleDateString("es-AR")}
									</td>
									<td>{payment.courseName}</td>
									<td>{payment.studentEmail}</td>
									<td>{formatMoney(payment.amount, payment.currency)}</td>
									<td>
										{formatMoney(payment.refundedAmount, payment.currency)}
									</td>
									<td>
										{payment.status === "succeeded" && (
											<form
												onSubmit={(event) => {
													event.preventDefault();
													const raw = String(
														new FormData(event.currentTarget).get("amount") ??
															"",
													).trim();
													onRefund(payment.id, raw === "" ? null : Number(raw));
												}}
											>
												<input
													name="amount"
													type="number"
													min="0.01"
													step="0.01"
													placeholder="Todo"
													aria-label="Monto parcial (vacío para reembolsar todo)"
												/>
												<button type="submit" disabled={pending}>
													Reembolsar
												</button>
											</form>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			)}

			{panel.refunds.length > 0 && (
				<section>
					<h2>Reembolsos</h2>
					<ul>
						{panel.refunds.map((refund) => (
							<li key={refund.id}>
								{new Date(refund.createdAt).toLocaleDateString("es-AR")} ·{" "}
								{refund.courseName} · {refund.studentEmail} ·{" "}
								{formatMoney(refund.amount, refund.currency)} ·{" "}
								{refund.requestedBy === "student"
									? "pedido por el alumno"
									: refund.requestedBy === "tenant"
										? "hecho desde el panel"
										: "hecho en el proveedor"}
							</li>
						))}
					</ul>
				</section>
			)}
			{message && <output>{message}</output>}
		</main>
	);
}
