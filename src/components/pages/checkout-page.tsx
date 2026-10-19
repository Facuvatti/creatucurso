import { Link } from "@tanstack/react-router";
import { formatMoney } from "../../shared/money.ts";

type Props = {
	courseName: string;
	courseSlug: string;
	amount: number;
	currency: string;
	/** idle: not started; ready: widget mounted; paying: confirming the payment */
	step: "idle" | "starting" | "ready" | "paying";
	error?: string | undefined;
	onStart: () => void;
	onPay: () => void;
};

export function CheckoutPage({
	courseName,
	courseSlug,
	amount,
	currency,
	step,
	error,
	onStart,
	onPay,
}: Props) {
	return (
		<main data-page="checkout">
			<p>
				<Link to="/cursos/$courseSlug" params={{ courseSlug }}>
					← {courseName}
				</Link>
			</p>
			<h1>Comprar {courseName}</h1>
			<p>Total: {formatMoney(amount, currency)}</p>

			{step === "idle" || step === "starting" ? (
				<button type="button" onClick={onStart} disabled={step === "starting"}>
					Continuar al pago
				</button>
			) : null}

			<div id="payment-element" />

			{step === "ready" || step === "paying" ? (
				<button type="button" onClick={onPay} disabled={step === "paying"}>
					Pagar {formatMoney(amount, currency)}
				</button>
			) : null}

			{error && <p role="alert">{error}</p>}
		</main>
	);
}
