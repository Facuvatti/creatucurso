import { randomUUID } from "node:crypto";
import { pool } from "../../server/db.server.ts";
import { appOrigin } from "../../server/origins.server.ts";
import {
	decryptSecret,
	encryptSecret,
} from "../../shared/crypto/secret-box.ts";
import {
	createGatewayPayment,
	createMerchant,
	type GatewayConfig,
	refundGatewayPayment,
	retrieveGatewayPayment,
} from "./hyperswitch.ts";
import {
	createPreference,
	findPaymentByReference,
	getChargeback,
	getPayment,
	getSeller,
	isValidSignature as isValidMercadoPagoSignature,
	type MercadoPagoPayment,
	refundPayment as refundMercadoPagoPayment,
} from "./mercadopago.ts";
import {
	type FulfillPayment,
	isValidSignature,
	type MerchantCredentials,
	mapGatewayStatus,
	PAYMENT_COLUMNS,
	type PaymentRecord,
	type PaymentRow,
	type PaymentStatus,
	parseWebhookEvent,
	toPaymentRecord,
} from "./payment.ts";
import { hasDispute, recordDispute, recordRefund } from "./refunds.ts";

export type PaymentsConfig = GatewayConfig & {
	/** Address Hyperswitch uses to call this app (webhooks). */
	webhookBaseUrl: string;
	/** Where the browser loads the Hyperswitch checkout script from. */
	sdkUrl: string;
	/** Address of Hyperswitch as the browser sees it. */
	publicUrl: string;
};

/** Settings for selling courses, or null when payments are not configured. */
export function paymentsConfig(): PaymentsConfig | null {
	const gatewayUrl = process.env.HYPERSWITCH_URL;
	const adminApiKey = process.env.HYPERSWITCH_ADMIN_API_KEY;
	if (!process.env.SECRETS_ENCRYPTION_KEY || !gatewayUrl || !adminApiKey) {
		return null;
	}
	return {
		gatewayUrl,
		adminApiKey,
		webhookBaseUrl: process.env.HYPERSWITCH_WEBHOOK_BASE_URL || appOrigin(),
		publicUrl: process.env.HYPERSWITCH_PUBLIC_URL || gatewayUrl,
		sdkUrl:
			process.env.HYPERSWITCH_SDK_URL ||
			"https://beta.hyperswitch.io/v1/HyperLoader.js",
	};
}

function secretsKey(): string {
	const key = process.env.SECRETS_ENCRYPTION_KEY;
	if (!key) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return key;
}

/** Mercado Pago only needs the key that encrypts the creators' credentials. */
export function mercadoPagoAvailable(): boolean {
	return !!process.env.SECRETS_ENCRYPTION_KEY;
}

/** Public address Mercado Pago calls for one academy's notifications. */
export function mercadoPagoWebhookUrl(organizationId: string): string {
	const base = process.env.MERCADOPAGO_WEBHOOK_BASE_URL || appOrigin();
	return `${base}/api/webhooks/mercadopago/${organizationId}`;
}

// ------------------------------------------------------------------- database

type MerchantRow = {
	organization_id: string;
	provider: MerchantCredentials["provider"];
	gateway_merchant_id: string;
	gateway_profile_id: string | null;
	publishable_key: string | null;
	api_key_encrypted: string;
	webhook_secret_encrypted: string;
};

export async function findMerchant(
	organizationId: string,
): Promise<MerchantCredentials | null> {
	const { rows } = await pool.query<MerchantRow>(
		`select organization_id, provider, gateway_merchant_id, gateway_profile_id,
		        publishable_key, api_key_encrypted, webhook_secret_encrypted
		 from payments.merchant where organization_id = $1`,
		[organizationId],
	);
	const row = rows[0];
	if (!row) return null;
	return {
		organizationId: row.organization_id,
		provider: row.provider,
		gatewayMerchantId: row.gateway_merchant_id,
		gatewayProfileId: row.gateway_profile_id ?? "",
		publishableKey: row.publishable_key ?? "",
		apiKey: decryptSecret(row.api_key_encrypted, secretsKey()),
		webhookSecret: decryptSecret(row.webhook_secret_encrypted, secretsKey()),
	};
}

/** Saves the academy's payment settings, replacing the previous provider's. */
async function saveMerchant(merchant: MerchantCredentials) {
	await pool.query(
		`insert into payments.merchant
		 (organization_id, provider, gateway_merchant_id, gateway_profile_id, publishable_key,
		  api_key_encrypted, webhook_secret_encrypted)
		 values ($1, $2, $3, $4, $5, $6, $7)
		 on conflict (organization_id) do update set
		   provider = excluded.provider,
		   gateway_merchant_id = excluded.gateway_merchant_id,
		   gateway_profile_id = excluded.gateway_profile_id,
		   publishable_key = excluded.publishable_key,
		   api_key_encrypted = excluded.api_key_encrypted,
		   webhook_secret_encrypted = excluded.webhook_secret_encrypted`,
		[
			merchant.organizationId,
			merchant.provider,
			merchant.gatewayMerchantId,
			merchant.gatewayProfileId || null,
			merchant.publishableKey || null,
			encryptSecret(merchant.apiKey, secretsKey()),
			encryptSecret(merchant.webhookSecret, secretsKey()),
		],
	);
}

async function queryPayment(
	where: string,
	values: unknown[],
): Promise<PaymentRecord | null> {
	const { rows } = await pool.query<PaymentRow>(
		`select ${PAYMENT_COLUMNS} from payments.payment where ${where}`,
		values,
	);
	return rows[0] ? toPaymentRecord(rows[0]) : null;
}

export function findPaymentByGatewayId(gatewayPaymentId: string) {
	return queryPayment("gateway_payment_id = $1", [gatewayPaymentId]);
}

export function findPaymentById(id: string) {
	return queryPayment("id = $1", [id]);
}

/** Looks a payment up by any id the browser may hold (ours, the gateway's or Mercado Pago's). */
export function findPaymentByAnyId(key: string) {
	return queryPayment(
		"(gateway_payment_id = $1 or provider_payment_id = $1 or id::text = $1)",
		[key],
	);
}

// -------------------------------------------------------------------- service

/** Hyperswitch: creates the academy's merchant there (or keeps the existing one). */
export async function activatePayments(
	config: PaymentsConfig,
	input: { organizationId: string; name: string; webhookUrl: string },
): Promise<MerchantCredentials> {
	const existing = await findMerchant(input.organizationId);
	if (existing?.provider === "hyperswitch") return existing;

	const created = await createMerchant(config, input);
	const merchant = { organizationId: input.organizationId, ...created };
	await saveMerchant(merchant);
	return merchant;
}

/** Mercado Pago: the creator's own credentials. Throws when the token is rejected. */
export async function connectMercadoPago(input: {
	organizationId: string;
	accessToken: string;
	webhookSecret: string;
}): Promise<void> {
	const seller = await getSeller(input.accessToken);
	await saveMerchant({
		organizationId: input.organizationId,
		provider: "mercadopago",
		gatewayMerchantId: seller.id,
		gatewayProfileId: "",
		publishableKey: "",
		apiKey: input.accessToken,
		webhookSecret: input.webhookSecret,
	});
}

export type CheckoutInput = {
	organizationId: string;
	course: { id: string; name: string; amount: number; currency: string };
	user: { id: string; email: string };
	returnUrl: string;
};

export type CheckoutResult =
	| {
			ok: true;
			provider: "hyperswitch";
			gatewayPaymentId: string;
			clientSecret: string;
			publishableKey: string;
	  }
	| { ok: true; provider: "mercadopago"; redirectUrl: string }
	| { ok: false; reason: "payments-not-active" };

export async function startCheckout(
	config: PaymentsConfig | null,
	input: CheckoutInput,
): Promise<CheckoutResult> {
	const merchant = await findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "payments-not-active" };

	if (merchant.provider === "mercadopago") {
		const paymentId = randomUUID();
		const preference = await createPreference(merchant.apiKey, {
			paymentId,
			title: input.course.name,
			amount: input.course.amount,
			currency: input.course.currency,
			backUrl: input.returnUrl,
			notificationUrl: mercadoPagoWebhookUrl(input.organizationId),
			payerEmail: input.user.email,
		});
		await pool.query(
			`insert into payments.payment
			 (id, organization_id, course_id, user_id, provider, gateway_payment_id, amount, currency)
			 values ($1, $2, $3, $4, 'mercadopago', $5, $6, $7)`,
			[
				paymentId,
				input.organizationId,
				input.course.id,
				input.user.id,
				preference.preferenceId,
				input.course.amount,
				input.course.currency,
			],
		);
		return {
			ok: true,
			provider: "mercadopago",
			redirectUrl: preference.initPoint,
		};
	}

	if (!config) return { ok: false, reason: "payments-not-active" };
	const created = await createGatewayPayment(config, merchant, {
		amount: input.course.amount,
		currency: input.course.currency,
		description: input.course.name,
		returnUrl: input.returnUrl,
		customerId: input.user.id,
		metadata: { courseId: input.course.id, userId: input.user.id },
	});

	await pool.query(
		`insert into payments.payment
		 (organization_id, course_id, user_id, gateway_payment_id, amount, currency)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			input.organizationId,
			input.course.id,
			input.user.id,
			created.gatewayPaymentId,
			input.course.amount,
			input.course.currency,
		],
	);

	return {
		ok: true,
		provider: "hyperswitch",
		gatewayPaymentId: created.gatewayPaymentId,
		clientSecret: created.clientSecret,
		publishableKey: merchant.publishableKey,
	};
}

async function setPaymentStatus(id: string, status: PaymentStatus) {
	await pool.query(
		`update payments.payment set status = $2, updated_at = now() where id = $1`,
		[id, status],
	);
}

/**
 * Records what the gateway says about a payment. When it succeeded, the
 * student is enrolled first and the payment is marked afterwards, so a failure
 * in between is retried by the next webhook instead of being lost.
 */
export async function applyGatewayStatus(
	fulfill: FulfillPayment,
	gatewayPaymentId: string,
	gatewayStatus: string,
): Promise<PaymentStatus | "unknown-payment"> {
	const payment = await findPaymentByGatewayId(gatewayPaymentId);
	if (!payment) return "unknown-payment";
	// A refunded payment never goes back, whatever a late event says.
	if (payment.status === "refunded") return "refunded";

	const status = mapGatewayStatus(gatewayStatus);
	if (status === "succeeded") {
		await fulfill(payment);
	}
	if (status !== payment.status) await setPaymentStatus(payment.id, status);
	return status;
}

export type WebhookOutcome =
	| { ok: true }
	| { ok: false; reason: "no-merchant" | "bad-signature" | "bad-payload" };

const DISPUTE_STATUS: Record<string, "open" | "won" | "lost"> = {
	dispute_opened: "open",
	dispute_challenged: "open",
	dispute_won: "won",
	dispute_cancelled: "won",
	dispute_lost: "lost",
	dispute_expired: "lost",
	dispute_accepted: "lost",
};

/** Verifies and applies a Hyperswitch webhook for one academy. */
export async function handleWebhook(
	fulfill: FulfillPayment,
	input: { organizationId: string; rawBody: string; signature: string | null },
): Promise<WebhookOutcome> {
	const merchant = await findMerchant(input.organizationId);
	if (!merchant || merchant.provider !== "hyperswitch") {
		return { ok: false, reason: "no-merchant" };
	}
	if (
		!isValidSignature(input.rawBody, merchant.webhookSecret, input.signature)
	) {
		return { ok: false, reason: "bad-signature" };
	}

	const event = parseWebhookEvent(input.rawBody);
	if (!event) return { ok: false, reason: "bad-payload" };
	if (!event.gatewayPaymentId) return { ok: true };

	const type = event.type ?? "";
	if (type.startsWith("refund_")) {
		const payment = await findPaymentByGatewayId(event.gatewayPaymentId);
		if (
			type === "refund_succeeded" &&
			payment &&
			payment.organizationId === merchant.organizationId &&
			event.refundId &&
			event.refundAmount
		) {
			await recordRefund(payment, {
				providerRefundId: event.refundId,
				amount: event.refundAmount,
				requestedBy: "provider",
			});
		}
	} else if (type.startsWith("dispute_")) {
		const payment = await findPaymentByGatewayId(event.gatewayPaymentId);
		const status = DISPUTE_STATUS[type];
		if (
			payment &&
			payment.organizationId === merchant.organizationId &&
			status
		) {
			await recordDispute(payment, {
				providerDisputeId: event.disputeId ?? `hyperswitch:${payment.id}`,
				status,
			});
		}
	} else if (event.status) {
		await applyGatewayStatus(fulfill, event.gatewayPaymentId, event.status);
	}
	return { ok: true };
}

// ---------------------------------------------------------------- Mercado Pago

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies a payment fetched from the Mercado Pago API (never the webhook body).
 * Our payment is found through external_reference, which we set to our id.
 */
async function applyMercadoPagoPayment(
	fulfill: FulfillPayment,
	merchant: MerchantCredentials,
	remote: MercadoPagoPayment,
): Promise<PaymentStatus | "unknown-payment"> {
	const reference = remote.external_reference;
	if (!reference || !UUID.test(reference)) return "unknown-payment";
	const payment = await findPaymentById(reference);
	if (
		!payment ||
		payment.organizationId !== merchant.organizationId ||
		payment.provider !== "mercadopago"
	) {
		return "unknown-payment";
	}
	if (Math.round(remote.transaction_amount * 100) !== payment.amount) {
		console.error(
			JSON.stringify({
				level: "error",
				msg: "Mercado Pago amount does not match our payment",
				paymentId: payment.id,
			}),
		);
		return "unknown-payment";
	}

	if (payment.providerPaymentId !== String(remote.id)) {
		await pool.query(
			"update payments.payment set provider_payment_id = $2 where id = $1",
			[payment.id, String(remote.id)],
		);
		payment.providerPaymentId = String(remote.id);
	}

	// Refunds done here or in the Mercado Pago dashboard.
	for (const refund of remote.refunds ?? []) {
		await recordRefund(payment, {
			providerRefundId: String(refund.id),
			amount: Math.round(refund.amount * 100),
			requestedBy: "provider",
		});
	}

	const current = await findPaymentById(payment.id);
	if (!current || current.status === "refunded") return "refunded";

	switch (remote.status) {
		case "approved":
			await fulfill(current);
			if (current.status !== "succeeded")
				await setPaymentStatus(current.id, "succeeded");
			return "succeeded";
		case "rejected":
		case "cancelled":
			if (current.status === "pending")
				await setPaymentStatus(current.id, "failed");
			return current.status === "pending" ? "failed" : current.status;
		case "charged_back":
			if (!(await hasDispute(current.id))) {
				await recordDispute(current, {
					providerDisputeId: `mercadopago:${remote.id}`,
					status: "lost",
				});
			}
			return current.status;
		default:
			return current.status;
	}
}

async function applyMercadoPagoChargeback(
	fulfill: FulfillPayment,
	merchant: MerchantCredentials,
	chargebackId: string,
): Promise<void> {
	const chargeback = await getChargeback(
		merchant.apiKey,
		chargebackId,
		merchant.gatewayMerchantId,
	);
	for (const mercadoPagoId of chargeback.payments) {
		const remote = await getPayment(merchant.apiKey, String(mercadoPagoId));
		// Make sure our payment knows the Mercado Pago id and refunds first.
		await applyMercadoPagoPayment(fulfill, merchant, remote);
		const reference = remote.external_reference;
		const payment =
			reference && UUID.test(reference)
				? await findPaymentById(reference)
				: null;
		if (!payment || payment.organizationId !== merchant.organizationId)
			continue;

		// Documented: coverage_applied true means the seller won, false that it lost.
		const status =
			chargeback.coverage_applied === true
				? "won"
				: remote.status === "charged_back"
					? "lost"
					: "open";
		await recordDispute(payment, {
			providerDisputeId: String(chargeback.id),
			status,
		});
	}
}

/** Verifies a Mercado Pago notification, then trusts only what the API says. */
export async function handleMercadoPagoWebhook(
	fulfill: FulfillPayment,
	input: {
		organizationId: string;
		topic: string | null;
		dataId: string | null;
		signature: string | null;
		requestId: string | null;
	},
): Promise<WebhookOutcome> {
	const merchant = await findMerchant(input.organizationId);
	if (!merchant || merchant.provider !== "mercadopago") {
		return { ok: false, reason: "no-merchant" };
	}
	if (
		!isValidMercadoPagoSignature({
			signature: input.signature,
			requestId: input.requestId,
			dataId: input.dataId,
			secret: merchant.webhookSecret,
		})
	) {
		return { ok: false, reason: "bad-signature" };
	}
	if (!input.dataId) return { ok: false, reason: "bad-payload" };

	switch (input.topic) {
		case "payment": {
			const remote = await getPayment(merchant.apiKey, input.dataId);
			await applyMercadoPagoPayment(fulfill, merchant, remote);
			break;
		}
		case "topic_chargebacks_wh":
		case "chargebacks":
			await applyMercadoPagoChargeback(fulfill, merchant, input.dataId);
			break;
		default:
			// Other topics (orders, claims...) are not used yet.
			break;
	}
	return { ok: true };
}

// --------------------------------------------------------- polling and refunds

/** Asks the provider about a pending payment (the student came back before the webhook). */
export async function refreshPayment(
	fulfill: FulfillPayment,
	config: PaymentsConfig | null,
	payment: PaymentRecord,
): Promise<PaymentStatus> {
	const merchant = await findMerchant(payment.organizationId);
	if (!merchant || merchant.provider !== payment.provider)
		return payment.status;

	if (payment.provider === "mercadopago") {
		const remote = payment.providerPaymentId
			? await getPayment(merchant.apiKey, payment.providerPaymentId)
			: await findPaymentByReference(merchant.apiKey, payment.id);
		if (!remote) return payment.status;
		const applied = await applyMercadoPagoPayment(fulfill, merchant, remote);
		return applied === "unknown-payment" ? payment.status : applied;
	}

	if (!config) return payment.status;
	const remote = await retrieveGatewayPayment(
		config,
		merchant,
		payment.gatewayPaymentId,
	);
	const applied = await applyGatewayStatus(
		fulfill,
		payment.gatewayPaymentId,
		remote.status,
	);
	return applied === "unknown-payment" ? payment.status : applied;
}

export type RefundResult = { ok: true } | { ok: false; message: string };

/**
 * Refunds a succeeded payment through its provider (full when `amount` is
 * omitted, partial otherwise, minor units) and records the result.
 */
export async function refundPayment(
	config: PaymentsConfig | null,
	payment: PaymentRecord,
	input: { amount?: number; requestedBy: "student" | "tenant" },
): Promise<RefundResult> {
	if (payment.status !== "succeeded") {
		return { ok: false, message: "Este pago no se puede reembolsar." };
	}
	const remaining = payment.amount - payment.refundedAmount;
	const amount = input.amount ?? remaining;
	if (!Number.isInteger(amount) || amount < 1 || amount > remaining) {
		return { ok: false, message: "El monto del reembolso no es válido." };
	}
	const merchant = await findMerchant(payment.organizationId);
	if (!merchant || merchant.provider !== payment.provider) {
		return {
			ok: false,
			message:
				"Este pago se cobró con otro proveedor que ya no está conectado. Reembolsalo desde ese proveedor.",
		};
	}
	// Omitting the amount asks the provider for a full refund of what is left.
	const requested = amount === remaining ? undefined : amount;

	try {
		if (payment.provider === "mercadopago") {
			if (!payment.providerPaymentId) {
				return { ok: false, message: "Todavía no tenemos el pago confirmado." };
			}
			const refund = await refundMercadoPagoPayment(
				merchant.apiKey,
				payment.providerPaymentId,
				requested,
			);
			await recordRefund(payment, {
				providerRefundId: refund.id,
				amount: refund.amount,
				requestedBy: input.requestedBy,
			});
		} else {
			if (!config)
				return { ok: false, message: "Los cobros no están configurados." };
			const refund = await refundGatewayPayment(config, merchant, {
				gatewayPaymentId: payment.gatewayPaymentId,
				...(requested === undefined ? {} : { amount: requested }),
			});
			if (refund.status !== "failed") {
				await recordRefund(payment, {
					providerRefundId: refund.refundId,
					amount: refund.amount,
					requestedBy: input.requestedBy,
				});
			}
		}
		return { ok: true };
	} catch (error) {
		console.error(
			JSON.stringify({
				level: "error",
				msg: "Refund failed",
				error: String(error),
			}),
		);
		return {
			ok: false,
			message:
				"El proveedor no pudo procesar el reembolso. Probá de nuevo más tarde.",
		};
	}
}
