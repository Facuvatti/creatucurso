import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { BillingPanel } from "../../server/billing.functions.ts";
import type { AcademyBilling } from "../../server/request.server.ts";
import { formatMoney } from "../../shared/money.ts";

const date = (iso: string) => new Date(iso).toLocaleDateString("es-AR");

const INVOICE_STATUS: Record<string, string> = {
	draft: "Borrador",
	open: "Pendiente",
	paid: "Pagada",
	failed: "Pago rechazado",
	void: "Anulada",
};

const SUBSCRIPTION_STATUS: Record<string, string> = {
	pending: "Esperando que la autorices en Mercado Pago",
	authorized: "Activa",
	paused: "Activa (sin cobros pendientes)",
	cancelled: "Cancelada",
};

type Props = {
	panel: BillingPanel;
	message?: string | undefined;
	pending: boolean;
	onSubscribe: (payerEmail: string) => void;
	onChoosePlan: (plan: BillingPanel["plan"]) => void;
};

export function BillingPanelPage({
	panel,
	message,
	pending,
	onSubscribe,
	onChoosePlan,
}: Props) {
	const [payerEmail, setPayerEmail] = useState(
		panel.subscription?.payerEmail ?? panel.ownerEmail,
	);
	const usable =
		panel.subscription?.status === "authorized" ||
		panel.subscription?.status === "paused";

	return (
		<main data-page="billing-panel">
			<p>
				<Link to="/panel">← Panel</Link>
			</p>
			<h1>Facturación</h1>
			{message && <p role="status">{message}</p>}

			<section>
				<h2>Tu plan</h2>
				{panel.status === "trial" && (
					<>
						<p data-status="active">
							Prueba gratis: te quedan {panel.trialDaysLeft} días (hasta el{" "}
							{date(panel.trialEndsAt)}).
						</p>
						<p>
							Alumnos: {panel.studentsUsed} de {panel.studentLimit}. Durante la
							prueba la academia puede tener hasta {panel.studentLimit} alumnos.
						</p>
					</>
				)}
				{panel.status === "active" && (
					<p data-status="active">Suscripción al día.</p>
				)}
				{panel.status === "past_due" && (
					<p data-status="warning" role="alert">
						Hay un pago pendiente. Regularizalo antes del{" "}
						{panel.suspendAt ? date(panel.suspendAt) : ""} para evitar la
						suspensión. Mercado Pago reintenta el cobro automáticamente.
					</p>
				)}
				{panel.status === "suspended" && (
					<p data-status="disconnected" role="alert">
						<strong>Tu academia está suspendida por falta de pago.</strong> Tus
						alumnos siguen estudiando, pero no podés sumar alumnos ni vender
						cursos hasta regularizar el pago. No borramos nada.
					</p>
				)}
				<p>
					Este mes hasta ahora:{" "}
					{formatMoney(panel.estimate.amount, panel.currency)} (
					{formatMoney(panel.estimate.fee, panel.currency)} de abono por{" "}
					{panel.estimate.publishedCourses} cursos publicados y{" "}
					{formatMoney(panel.estimate.commission, panel.currency)} de comisión
					por {panel.estimate.salesCount} ventas).
				</p>
			</section>

			<section>
				<h2>Planes</h2>
				<p>
					Todos los planes incluyen todas las funciones. Se paga por mes y por
					curso publicado. La pasarela de pago cobra aparte su propia comisión
					(cerca del 2%).
				</p>
				<table>
					<thead>
						<tr>
							<th>Plan</th>
							<th>Abono por curso</th>
							<th>Comisión por venta</th>
							<th>Mínimo por venta</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{panel.plans.map((plan) => (
							<tr key={plan.id}>
								<td>
									{plan.name}
									{plan.id === "flat" && " (3 cursos: $25.000 por mes)"}
								</td>
								<td>{formatMoney(plan.feePerCourse, panel.currency)}</td>
								<td>{Math.round(plan.rate * 100)}%</td>
								<td>
									{plan.minPerSale
										? formatMoney(plan.minPerSale, panel.currency)
										: "—"}
								</td>
								<td>
									{plan.id === panel.plan && !panel.nextPlan ? (
										<strong>Tu plan</strong>
									) : plan.id === panel.nextPlan?.plan ? (
										<span>Desde el {date(panel.nextPlan.from)}</span>
									) : (
										<button
											type="button"
											disabled={pending}
											onClick={() => onChoosePlan(plan.id)}
										>
											Elegir
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<p>
					Un cambio de plan rige desde el 1 del mes siguiente (durante la prueba
					gratis, desde ya).
				</p>
			</section>

			<section>
				<h2>Suscripción</h2>
				{panel.subscription && (
					<p>
						Estado: {SUBSCRIPTION_STATUS[panel.subscription.status] ?? "—"} (
						{panel.subscription.payerEmail})
					</p>
				)}
				{!panel.available ? (
					<p>
						Las suscripciones todavía no están disponibles en esta instalación.
					</p>
				) : (
					!usable && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								onSubscribe(payerEmail);
							}}
						>
							<label>
								Email de tu cuenta de Mercado Pago
								<input
									type="email"
									required
									value={payerEmail}
									onChange={(event) => setPayerEmail(event.target.value)}
								/>
							</label>
							<button type="submit" disabled={pending}>
								Activar suscripción
							</button>
							<p>
								Te llevamos a Mercado Pago para autorizar el cobro mensual
								automático. Si tenés pagos pendientes, se cobran al autorizar.
							</p>
						</form>
					)
				)}
			</section>

			<section>
				<h2>Facturas</h2>
				{panel.invoices.length === 0 ? (
					<p>Todavía no hay facturas.</p>
				) : (
					<table>
						<thead>
							<tr>
								<th>Mes</th>
								<th>Monto</th>
								<th>Estado</th>
							</tr>
						</thead>
						<tbody>
							{panel.invoices.map((invoice) => (
								<tr key={invoice.id}>
									<td>{invoice.period}</td>
									<td>{formatMoney(invoice.amount, invoice.currency)}</td>
									<td>
										{INVOICE_STATUS[invoice.status] ?? invoice.status}
										{invoice.paidAt ? ` (${date(invoice.paidAt)})` : ""}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</main>
	);
}

/** The notice of the tenant layout: everyone sees a suspension, staff also a pending payment. */
export function BillingNotice({
	billing,
	staff,
	owner,
}: {
	billing: AcademyBilling;
	staff: boolean;
	owner: boolean;
}) {
	const link = owner ? (
		<>
			{" "}
			<a href="/panel/facturacion">Ir a Facturación</a>
		</>
	) : null;
	if (billing.status === "suspended") {
		return (
			<p data-status="disconnected" role="alert">
				{staff
					? "Tu academia está suspendida por falta de pago: tus alumnos siguen estudiando, pero no podés sumar alumnos ni vender cursos hasta regularizar la suscripción."
					: "Esta academia está suspendida temporalmente. Quienes ya están inscriptos pueden seguir estudiando; por ahora no se aceptan nuevas inscripciones."}
				{staff && link}
			</p>
		);
	}
	if (billing.status === "past_due" && staff) {
		return (
			<p data-status="warning" role="alert">
				Hay un pago pendiente de la suscripción de tu academia. Regularizalo
				{billing.suspendAt ? ` antes del ${date(billing.suspendAt)}` : ""} para
				evitar la suspensión.{link}
			</p>
		);
	}
	return null;
}
