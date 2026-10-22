import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** API base. The env override exists only so a local mock can stand in for Mercado Pago. */
function apiUrl(): string {
	return process.env.MP_API_URL || "https://api.mercadopago.com";
}

/**
 * A failed call. The message carries only the HTTP status and Mercado Pago's
 * error code, never the response body (it may hold payment data).
 */
export class MercadoPagoError extends Error {
	// Explicit fields: Node runs the worker directly and cannot strip parameter properties.
	readonly status: number;
	readonly code: string | null;

	constructor(status: number, code: string | null, what: string) {
		super(`Mercado Pago ${what} failed: ${status}${code ? ` ${code}` : ""}`);
		this.name = "MercadoPagoError";
		this.status = status;
		this.code = code;
	}
}

/** Text that is safe to log about any error: no bodies, no tokens. */
export function describeError(error: unknown): string {
	if (error instanceof MercadoPagoError) return error.message;
	return error instanceof Error ? error.name : "unknown error";
}

/** The short code Mercado Pago puts in `error` (or `message`) of a failure. */
function errorCode(text: string): string | null {
	try {
		const body = JSON.parse(text) as { error?: unknown; message?: unknown };
		for (const value of [body.error, body.message]) {
			if (typeof value === "string" && /^[\w .:-]{1,60}$/.test(value)) {
				return value;
			}
		}
	} catch {
		// Not JSON.
	}
	return null;
}

async function request<T>(
	method: "GET" | "POST" | "PUT",
	path: string,
	options: { body?: unknown; headers?: Record<string, string> },
): Promise<T> {
	const response = await fetch(`${apiUrl()}${path}`, {
		method,
		headers: { "content-type": "application/json", ...options.headers },
		body: options.body === undefined ? null : JSON.stringify(options.body),
		signal: AbortSignal.timeout(15_000),
	});
	const text = await response.text();
	if (!response.ok) {
		// The query string is left out of the message: it may hold ids of people.
		throw new MercadoPagoError(
			response.status,
			errorCode(text),
			`${method} ${path.split("?")[0]}`,
		);
	}
	return JSON.parse(text) as T;
}

function call<T>(
	method: "GET" | "POST" | "PUT",
	path: string,
	accessToken: string,
	options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
	return request<T>(method, path, {
		...options,
		headers: { authorization: `Bearer ${accessToken}`, ...options.headers },
	});
}

// ---------------------------------------------------------------------- OAuth

export type OAuthTokens = {
	accessToken: string;
	refreshToken: string | null;
	publicKey: string | null;
	userId: string;
	expiresAt: Date;
};

/** Checks the token response by hand: the fields we store must be there. */
function readTokens(raw: unknown): OAuthTokens {
	const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const userId = body.user_id;
	if (
		typeof body.access_token !== "string" ||
		(typeof userId !== "number" && typeof userId !== "string")
	) {
		throw new MercadoPagoError(
			502,
			"invalid_token_response",
			"POST /oauth/token",
		);
	}
	// Access tokens last 180 days when Mercado Pago does not say otherwise.
	const seconds =
		typeof body.expires_in === "number" ? body.expires_in : 180 * 86_400;
	return {
		accessToken: body.access_token,
		refreshToken:
			typeof body.refresh_token === "string" ? body.refresh_token : null,
		publicKey: typeof body.public_key === "string" ? body.public_key : null,
		userId: String(userId),
		expiresAt: new Date(Date.now() + seconds * 1000),
	};
}

/** The platform application's id and secret (the credentials of our one MP app). */
function appCredentials() {
	const clientId = process.env.MP_CLIENT_ID;
	const secret = process.env.MP_CLIENT_SECRET;
	if (!clientId || !secret) {
		throw new Error("The Mercado Pago application is not configured.");
	}
	return { client_id: clientId, client_secret: secret };
}

/** Exchanges the code Mercado Pago sent to the callback for the seller's tokens. */
export async function exchangeAuthorizationCode(input: {
	code: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<OAuthTokens> {
	const raw = await request<unknown>("POST", "/oauth/token", {
		body: {
			...appCredentials(),
			grant_type: "authorization_code",
			code: input.code,
			redirect_uri: input.redirectUri,
			code_verifier: input.codeVerifier,
		},
	});
	return readTokens(raw);
}

/** Mercado Pago rotates the refresh token: the caller must store the new one. */
export async function refreshAccessToken(
	refreshToken: string,
): Promise<OAuthTokens> {
	const raw = await request<unknown>("POST", "/oauth/token", {
		body: {
			...appCredentials(),
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		},
	});
	return readTokens(raw);
}

// ------------------------------------------------------------------- payments

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
		/** Marketplace fee in minor units; left out of the preference when 0. */
		fee: number;
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
				// An amount in the preference's currency, not a percentage.
				...(input.fee > 0 ? { marketplace_fee: input.fee / 100 } : {}),
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

// ------------------------------------------- platform subscriptions (ADR-0029)
// The academies pay the platform with a Mercado Pago subscription (preapproval
// without a plan) created with the PLATFORM's own access token, never with an
// academy's connected token.

function platformToken(): string {
	const token = process.env.MP_PLATFORM_ACCESS_TOKEN;
	if (!token) throw new Error("MP_PLATFORM_ACCESS_TOKEN is not configured.");
	return token;
}

export type Preapproval = {
	id: string;
	/** pending, authorized, paused or cancelled */
	status: string;
	init_point?: string;
	external_reference?: string | null;
	auto_recurring?: { transaction_amount?: number; currency_id?: string };
	next_payment_date?: string | null;
};

/**
 * A monthly subscription the payer authorizes at `initPoint`. Without
 * `startDate` Mercado Pago charges the first installment right after the payer
 * authorizes it. `amount` is in minor units.
 */
export async function createPreapproval(input: {
	organizationId: string;
	reason: string;
	payerEmail: string;
	amount: number;
	currency: string;
	backUrl: string;
	startDate: Date | null;
}): Promise<{ id: string; status: string; initPoint: string }> {
	const created = await call<Preapproval>(
		"POST",
		"/preapproval",
		platformToken(),
		{
			body: {
				reason: input.reason,
				external_reference: input.organizationId,
				payer_email: input.payerEmail,
				auto_recurring: {
					frequency: 1,
					frequency_type: "months",
					transaction_amount: input.amount / 100,
					currency_id: input.currency,
					...(input.startDate
						? { start_date: input.startDate.toISOString() }
						: {}),
				},
				back_url: input.backUrl,
				status: "pending",
			},
			headers: { "x-idempotency-key": randomUUID() },
		},
	);
	if (!created.init_point) {
		throw new MercadoPagoError(502, "missing_init_point", "POST /preapproval");
	}
	return {
		id: String(created.id),
		status: created.status,
		initPoint: created.init_point,
	};
}

export function getPreapproval(id: string) {
	return call<Preapproval>(
		"GET",
		`/preapproval/${encodeURIComponent(id)}`,
		platformToken(),
	);
}

/** Changes the amount of the next charges (minor units) and/or pauses or resumes the subscription. */
export function updatePreapproval(
	id: string,
	change: {
		amount?: { value: number; currency: string };
		status?: "authorized" | "paused" | "cancelled";
	},
) {
	return call<Preapproval>(
		"PUT",
		`/preapproval/${encodeURIComponent(id)}`,
		platformToken(),
		{
			body: {
				...(change.amount
					? {
							auto_recurring: {
								transaction_amount: change.amount.value / 100,
								currency_id: change.amount.currency,
							},
						}
					: {}),
				...(change.status ? { status: change.status } : {}),
			},
		},
	);
}

/** One recurring charge of a subscription (an "authorized payment" / invoice in Mercado Pago's words). */
export type AuthorizedPayment = {
	id: number | string;
	preapproval_id: string;
	/** scheduled, processed, recycling (rejected, will be retried) or cancelled */
	status: string;
	transaction_amount: number;
	currency_id?: string;
	payment?: {
		id?: number | string;
		status?: string;
		status_detail?: string;
	} | null;
};

export function getAuthorizedPayment(id: string) {
	return call<AuthorizedPayment>(
		"GET",
		`/authorized_payments/${encodeURIComponent(id)}`,
		platformToken(),
	);
}

/**
 * Checks the x-signature header ("ts=...,v1=..."): HMAC-SHA256 of
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" with the webhook secret.
 * Parts missing from the notification (data.id on mp-connect) are left out.
 */
export function isValidSignature(input: {
	signature: string | null;
	requestId: string | null;
	dataId: string | null;
	secret: string;
}): boolean {
	if (!input.signature) return false;
	let ts = "";
	let v1 = "";
	for (const part of input.signature.split(",")) {
		const [key, value] = part.split("=").map((piece) => piece.trim());
		if (key === "ts") ts = value ?? "";
		if (key === "v1") v1 = value ?? "";
	}
	if (!ts || !v1) return false;
	// Mercado Pago lowercases alphanumeric ids when it signs.
	const manifest = `${input.dataId ? `id:${input.dataId.toLowerCase()};` : ""}${
		input.requestId ? `request-id:${input.requestId};` : ""
	}ts:${ts};`;
	const expected = createHmac("sha256", input.secret)
		.update(manifest)
		.digest("hex");
	const received = Buffer.from(v1.toLowerCase(), "utf8");
	const wanted = Buffer.from(expected, "utf8");
	return received.length === wanted.length && timingSafeEqual(received, wanted);
}

export type Notification = {
	topic: string | null;
	action: string | null;
	dataId: string | null;
	/** The seller (`user_id`) the notification is about. */
	sellerId: string | null;
};

/** What we use from a notification. The signature is computed over the `data.id` of the query string. */
export async function readNotification(
	request: Request,
): Promise<Notification> {
	const url = new URL(request.url);
	let body: Record<string, unknown> = {};
	try {
		const parsed: unknown = await request.json();
		if (typeof parsed === "object" && parsed !== null) {
			body = parsed as Record<string, unknown>;
		}
	} catch {
		// Some notifications carry everything in the query string.
	}
	const text = (value: unknown) =>
		typeof value === "string" || typeof value === "number"
			? String(value)
			: null;
	const data = body.data as { id?: unknown } | undefined;
	return {
		topic:
			text(body.type) ??
			url.searchParams.get("type") ??
			url.searchParams.get("topic"),
		action: text(body.action),
		dataId: url.searchParams.get("data.id") ?? text(data?.id),
		sellerId: text(body.user_id),
	};
}
