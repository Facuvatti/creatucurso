import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Every Mercado Pago call goes here; change it only to point at a mock. */
const MERCADOPAGO_API = "https://api.mercadopago.com";

export class MercadoPagoError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "MercadoPagoError";
	}
}

async function call<T>(
	method: "GET" | "POST",
	path: string,
	accessToken: string,
	options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
	const response = await fetch(`${MERCADOPAGO_API}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${accessToken}`,
			"content-type": "application/json",
			...options.headers,
		},
		body: options.body === undefined ? null : JSON.stringify(options.body),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new MercadoPagoError(
			response.status,
			`Mercado Pago ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`,
		);
	}
	return JSON.parse(text) as T;
}

/** The seller account the access token belongs to (also checks the token works). */
export async function getSeller(accessToken: string): Promise<{ id: string }> {
	const me = await call<{ id: number | string }>(
		"GET",
		"/users/me",
		accessToken,
	);
	return { id: String(me.id) };
}

/** Checkout Pro: the student is sent to `initPoint` to pay. */
export async function createPreference(
	accessToken: string,
	input: {
		paymentId: string;
		title: string;
		amount: number;
		currency: string;
		backUrl: string;
		notificationUrl: string;
		payerEmail: string;
	},
): Promise<{ preferenceId: string; initPoint: string }> {
	const preference = await call<{ id: string; init_point: string }>(
		"POST",
		"/checkout/preferences",
		accessToken,
		{
			body: {
				items: [
					{
						title: input.title,
						quantity: 1,
						currency_id: input.currency,
						unit_price: input.amount / 100,
					},
				],
				payer: { email: input.payerEmail },
				back_urls: {
					success: input.backUrl,
					pending: input.backUrl,
					failure: input.backUrl,
				},
				auto_return: "approved",
				notification_url: input.notificationUrl,
				external_reference: input.paymentId,
			},
		},
	);
	return { preferenceId: preference.id, initPoint: preference.init_point };
}

export type MercadoPagoPayment = {
	id: number;
	status: string;
	external_reference: string | null;
	transaction_amount: number;
	refunds?: { id: number | string; amount: number }[];
};

export function getPayment(accessToken: string, id: string) {
	return call<MercadoPagoPayment>(
		"GET",
		`/v1/payments/${encodeURIComponent(id)}`,
		accessToken,
	);
}

/** The most recent payment made for one of our payment ids, or null. */
export async function findPaymentByReference(
	accessToken: string,
	externalReference: string,
): Promise<MercadoPagoPayment | null> {
	const found = await call<{ results: MercadoPagoPayment[] }>(
		"GET",
		`/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`,
		accessToken,
	);
	return found.results[0] ?? null;
}

export type MercadoPagoChargeback = {
	id: number | string;
	payments: (number | string)[];
	/** true: the seller won the dispute, false: the seller lost it. Set on resolution. */
	coverage_applied?: boolean | null;
};

export function getChargeback(
	accessToken: string,
	id: string,
	sellerId: string,
) {
	return call<MercadoPagoChargeback>(
		"GET",
		`/v1/chargebacks/${encodeURIComponent(id)}`,
		accessToken,
		{ headers: { "x-caller-id": sellerId } },
	);
}

/** Full refund when `amount` is omitted, partial otherwise (minor units). */
export async function refundPayment(
	accessToken: string,
	mercadoPagoPaymentId: string,
	amount?: number,
): Promise<{ id: string; amount: number }> {
	const refund = await call<{ id: number | string; amount: number }>(
		"POST",
		`/v1/payments/${encodeURIComponent(mercadoPagoPaymentId)}/refunds`,
		accessToken,
		{
			body: amount === undefined ? {} : { amount: amount / 100 },
			headers: { "x-idempotency-key": randomUUID() },
		},
	);
	return { id: String(refund.id), amount: Math.round(refund.amount * 100) };
}

/**
 * Checks the x-signature header ("ts=...,v1=..."): HMAC-SHA256 of
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" with the webhook secret.
 */
export function isValidSignature(input: {
	signature: string | null;
	requestId: string | null;
	dataId: string | null;
	secret: string;
}): boolean {
	if (!input.signature || !input.requestId || !input.dataId) return false;
	let ts = "";
	let v1 = "";
	for (const part of input.signature.split(",")) {
		const [key, value] = part.split("=").map((piece) => piece.trim());
		if (key === "ts") ts = value ?? "";
		if (key === "v1") v1 = value ?? "";
	}
	if (!ts || !v1) return false;
	// Mercado Pago lowercases alphanumeric ids when it signs.
	const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${ts};`;
	const expected = createHmac("sha256", input.secret)
		.update(manifest)
		.digest("hex");
	const received = Buffer.from(v1.toLowerCase(), "utf8");
	const wanted = Buffer.from(expected, "utf8");
	return received.length === wanted.length && timingSafeEqual(received, wanted);
}
