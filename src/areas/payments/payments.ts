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
	describeError,
	findPaymentByReference,
	getChargeback,
	getPayment,
	getSeller,
	isValidSignature as isValidMercadoPagoSignature,
	type MercadoPagoPayment,
	refundPayment as refundMercadoPagoPayment,
} from "./mercadopago.ts";
import {
	findConnection,
	findOrganizationByMpUser,
	MercadoPagoDisconnected,
	markDisconnected,
	withSellerToken,
} from "./mercadopago-connection.ts";
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

export { MercadoPagoDisconnected };

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

/** The platform's Mercado Pago application is configured (ADR-0023). */
export function mercadoPagoAvailable(): boolean {
	return !!(
		process.env.MP_CLIENT_ID &&
		process.env["MP_CLIENT_" + "SECRET"] &&
		process.env.MP_WEBHOOK_SECRET &&
		process.env.SECRETS_ENCRYPTION_KEY
	);
}

/** The one address Mercado Pago calls for every academy's notifications. */
export function mercadoPagoWebhookUrl(): string {
	const base = process.env.MERCADOPAGO_WEBHOOK_BASE_URL || appOrigin();
	return `${base}/api/webhooks/mercadopago`;
}

// LEGACY: remove after migration (academies with pasted credentials).
function legacyMercadoPagoWebhookUrl(organizationId: string): string {
	return `${mercadoPagoWebhookUrl()}/${organizationId}`;
}

/** Marketplace fee for a charge in minor units; 0 (field omitted) unless configured. */
function marketplaceFee(amount: number): number {
	const percent = Number(process.env.MP_MARKETPLACE_FEE_PERCENT || 0);
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		throw new Error(
			"MP_MARKETPLACE_FEE_PERCENT must be a number from 0 to 100.",
		);
	}
	return Math.round((amount * percent) / 100);
}

/**
 * How we reach one academy's Mercado Pago seller account: through its OAuth
 * connection (tokens renewed for us) or, LEGACY, the token it pasted by hand.
 */
type MercadoPagoAccount = {
	organizationId: string;
	sellerId: string;
	/** LEGACY: remove after migration. */
	legacy: boolean;
	run: <T>(call: (accessToken: string) => Promise<T>) => Promise<T>;
};

async function findMercadoPagoAccount(
	organizationId: string,
): Promise<MercadoPagoAccount | null> {
	const connection = await findConnection(organizationId);
	if (connection) {
		return {
			organizationId,
			sellerId: connection.mpUserId,
			legacy: false,
			run: (call) => withSellerToken(organizationId, call),
		};
	}
	// LEGACY: remove after migration.
	const merchant = await findMerchant(organizationId);
	if (merchant?.provider !== "mercadopago") return null;
	return {
		organizationId,
		sellerId: merchant.gatewayMerchantId,
		legacy: true,
		run: (call) => call(merchant.apiKey),
	};
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
	// Switching to Hyperswitch (the caller refuses while Mercado Pago is connected).
	await pool.query(
		"delete from payments.mercadopago_connection where organization_id = $1",
		[input.organizationId],
	);
	return merchant;
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
	| { ok: false; reason: "payments-not-active" | "payments-unavailable" };

export async function startCheckout(
	config: PaymentsConfig | null,
	input: CheckoutInput,
): Promise<CheckoutResult> {
	const account = await findMercadoPagoAccount(input.organizationId);
	if (account) {
		const paymentId = randomUUID();
		let preference: Awaited<ReturnType<typeof createPreference>>;
		try {
			preference = await account.run((accessToken) =>
				createPreference(accessToken, {
					paymentId,
					title: input.course.name,
					amount: input.course.amount,
					currency: input.course.currency,
					backUrl: input.returnUrl,
					notificationUrl: account.legacy
						? legacyMercadoPagoWebhookUrl(input.organizationId)
						: mercadoPagoWebhookUrl(),
					payerEmail: input.user.email,
					fee: account.legacy ? 0 : marketplaceFee(input.course.amount),
				}),
			);
		} catch (error) {
			if (error instanceof MercadoPagoDisconnected) {
				return { ok: false, reason: "payments-unavailable" };
			}
			throw error;
		}
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

	const merchant = await findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "payments-not-active" };
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
	| {
			ok: false;
			reason: "no-merchant" | "bad-signature" | "bad-payload" | "disconnected";
	  };

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
	organizationId: string,
	remote: MercadoPagoPayment,
): Promise<PaymentStatus | "unknown-payment"> {
	const reference = remote.external_reference;
	if (!reference || !UUID.test(reference)) return "unknown-payment";
	const payment = await findPaymentById(reference);
	if (
		!payment ||
		payment.organizationId !== organizationId ||
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
	account: MercadoPagoAccount,
	chargebackId: string,
): Promise<void> {
	const chargeback = await account.run((accessToken) =>
		getChargeback(accessToken, chargebackId, account.sellerId),
	);
	for (const mercadoPagoId of chargeback.payments) {
		const remote = await account.run((accessToken) =>
			getPayment(accessToken, String(mercadoPagoId)),
		);
		// Make sure our payment knows the Mercado Pago id and refunds first.
		await applyMercadoPagoPayment(fulfill, account.organizationId, remote);
		const reference = remote.external_reference;
		const payment =
			reference && UUID.test(reference)
				? await findPaymentById(reference)
				: null;
		if (!payment || payment.organizationId !== account.organizationId) continue;

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

/** Applies one verified notification, trusting only what the API answers. */
async function applyMercadoPagoNotification(
	fulfill: FulfillPayment,
	account: MercadoPagoAccount,
	topic: string | null,
	dataId: string,
): Promise<void> {
	switch (topic) {
		case "payment": {
			const remote = await account.run((accessToken) =>
				getPayment(accessToken, dataId),
			);
			await applyMercadoPagoPayment(fulfill, account.organizationId, remote);
			break;
		}
		case "topic_chargebacks_wh":
		case "chargebacks":
			await applyMercadoPagoChargeback(fulfill, account, dataId);
			break;
		default:
			// Other topics (orders, claims...) are not used yet.
			break;
	}
}

/**
 * LEGACY: remove after migration. Notification of an academy that still uses
 * credentials pasted by hand, verified with that academy's own secret.
 */
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

	const account: MercadoPagoAccount = {
		organizationId: merchant.organizationId,
		sellerId: merchant.gatewayMerchantId,
		legacy: true,
		run: (call) => call(merchant.apiKey),
	};
	await applyMercadoPagoNotification(
		fulfill,
		account,
		input.topic,
		input.dataId,
	);
	return { ok: true };
}

/**
 * The platform webhook: one URL for every academy. The signature uses the
 * application's secret and the seller `user_id` of the notification says which
 * academy it is for.
 */
export async function handlePlatformMercadoPagoWebhook(
	fulfill: FulfillPayment,
	input: {
		sellerId: string | null;
		topic: string | null;
		action: string | null;
		dataId: string | null;
		signature: string | null;
		requestId: string | null;
	},
): Promise<WebhookOutcome> {
	const secret = process.env.MP_WEBHOOK_SECRET;
	if (
		!secret ||
		!isValidMercadoPagoSignature({
			signature: input.signature,
			requestId: input.requestId,
			dataId: input.dataId,
			secret,
		})
	) {
		return { ok: false, reason: "bad-signature" };
	}
	if (!input.sellerId) return { ok: false, reason: "bad-payload" };
	const organizationId = await findOrganizationByMpUser(input.sellerId);
	if (!organizationId) return { ok: false, reason: "no-merchant" };
	const account = await findMercadoPagoAccount(organizationId);
	if (!account) return { ok: false, reason: "no-merchant" };

	try {
		if (input.topic === "mp-connect") {
			// The topic covers linking and unlinking. The signed notification says
			// which one; any other case is checked against the API with the token.
			if (/unlink|deauthori/i.test(input.action ?? "")) {
				await markDisconnected(
					organizationId,
					"Mercado Pago deauthorized the app",
				);
			} else {
				await account.run((accessToken) => getSeller(accessToken));
			}
			return { ok: true };
		}
		if (!input.dataId) return { ok: false, reason: "bad-payload" };
		await applyMercadoPagoNotification(
			fulfill,
			account,
			input.topic,
			input.dataId,
		);
	} catch (error) {
		if (error instanceof MercadoPagoDisconnected) {
			return { ok: false, reason: "disconnected" };
		}
		throw error;
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
	if (payment.provider === "mercadopago") {
		const account = await findMercadoPagoAccount(payment.organizationId);
		if (!account) return payment.status;
		try {
			const remote = await account.run((accessToken) =>
				payment.providerPaymentId
					? getPayment(accessToken, payment.providerPaymentId)
					: findPaymentByReference(accessToken, payment.id),
			);
			if (!remote) return payment.status;
			const applied = await applyMercadoPagoPayment(
				fulfill,
				account.organizationId,
				remote,
			);
			return applied === "unknown-payment" ? payment.status : applied;
		} catch (error) {
			if (error instanceof MercadoPagoDisconnected) return payment.status;
			throw error;
		}
	}

	const merchant = await findMerchant(payment.organizationId);
	if (!merchant || merchant.provider !== payment.provider)
		return payment.status;
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
	const account =
		payment.provider === "mercadopago"
			? await findMercadoPagoAccount(payment.organizationId)
			: null;
	const merchant = await findMerchant(payment.organizationId);
	if (
		payment.provider === "mercadopago"
			? !account
			: !merchant || merchant.provider !== payment.provider
	) {
		return {
			ok: false,
			message:
				"Este pago se cobró con otro proveedor que ya no está conectado. Reembolsalo desde ese proveedor.",
		};
	}
	// Omitting the amount asks the provider for a full refund of what is left.
	const requested = amount === remaining ? undefined : amount;

	try {
		if (payment.provider === "mercadopago" && account) {
			const providerPaymentId = payment.providerPaymentId;
			if (!providerPaymentId) {
				return { ok: false, message: "Todavía no tenemos el pago confirmado." };
			}
			const refund = await account.run((accessToken) =>
				refundMercadoPagoPayment(accessToken, providerPaymentId, requested),
			);
			await recordRefund(payment, {
				providerRefundId: refund.id,
				amount: refund.amount,
				requestedBy: input.requestedBy,
			});
		} else if (merchant) {
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
		if (error instanceof MercadoPagoDisconnected) {
			return {
				ok: false,
				message:
					"Mercado Pago está desconectado. Reconectá tu cuenta para poder reembolsar.",
			};
		}
		console.error(
			JSON.stringify({
				level: "error",
				msg: "Refund failed",
				paymentId: payment.id,
				error: describeError(error),
			}),
		);
		return {
			ok: false,
			message:
				"El proveedor no pudo procesar el reembolso. Probá de nuevo más tarde.",
		};
	}
}
