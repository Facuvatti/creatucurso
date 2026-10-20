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
} from "./hyperswitch.ts";
import {
	type FulfillPayment,
	isValidSignature,
	type MerchantCredentials,
	mapGatewayStatus,
	type PaymentRecord,
	type PaymentStatus,
	parseWebhookEvent,
} from "./payment.ts";

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

// ------------------------------------------------------------------- database

type MerchantRow = {
	organization_id: string;
	gateway_merchant_id: string;
	gateway_profile_id: string;
	publishable_key: string;
	api_key_encrypted: string;
	webhook_secret_encrypted: string;
};

type PaymentRow = {
	id: string;
	organization_id: string;
	course_id: string;
	user_id: string;
	gateway_payment_id: string;
	amount: number;
	currency: string;
	status: PaymentStatus;
};

export async function findMerchant(
	organizationId: string,
): Promise<MerchantCredentials | null> {
	const { rows } = await pool.query<MerchantRow>(
		`select organization_id, gateway_merchant_id, gateway_profile_id,
		        publishable_key, api_key_encrypted, webhook_secret_encrypted
		 from payments.merchant where organization_id = $1`,
		[organizationId],
	);
	const row = rows[0];
	if (!row) return null;
	return {
		organizationId: row.organization_id,
		gatewayMerchantId: row.gateway_merchant_id,
		gatewayProfileId: row.gateway_profile_id,
		publishableKey: row.publishable_key,
		apiKey: decryptSecret(row.api_key_encrypted, secretsKey()),
		webhookSecret: decryptSecret(row.webhook_secret_encrypted, secretsKey()),
	};
}

async function saveMerchant(merchant: MerchantCredentials) {
	await pool.query(
		`insert into payments.merchant
		 (organization_id, gateway_merchant_id, gateway_profile_id, publishable_key,
		  api_key_encrypted, webhook_secret_encrypted)
		 values ($1, $2, $3, $4, $5, $6)
		 on conflict (organization_id) do nothing`,
		[
			merchant.organizationId,
			merchant.gatewayMerchantId,
			merchant.gatewayProfileId,
			merchant.publishableKey,
			encryptSecret(merchant.apiKey, secretsKey()),
			encryptSecret(merchant.webhookSecret, secretsKey()),
		],
	);
}

export async function findPaymentByGatewayId(
	gatewayPaymentId: string,
): Promise<PaymentRecord | null> {
	const { rows } = await pool.query<PaymentRow>(
		`select id, organization_id, course_id, user_id, gateway_payment_id, amount, currency, status
		 from payments.payment where gateway_payment_id = $1`,
		[gatewayPaymentId],
	);
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		organizationId: row.organization_id,
		courseId: row.course_id,
		userId: row.user_id,
		gatewayPaymentId: row.gateway_payment_id,
		amount: row.amount,
		currency: row.currency,
		status: row.status,
	};
}

// -------------------------------------------------------------------- service

export async function activatePayments(
	config: PaymentsConfig,
	input: { organizationId: string; name: string; webhookUrl: string },
): Promise<MerchantCredentials> {
	const existing = await findMerchant(input.organizationId);
	if (existing) return existing;

	const created = await createMerchant(config, input);
	const merchant = { organizationId: input.organizationId, ...created };
	await saveMerchant(merchant);
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
			gatewayPaymentId: string;
			clientSecret: string;
			publishableKey: string;
	  }
	| { ok: false; reason: "payments-not-active" };

export async function startCheckout(
	config: PaymentsConfig,
	input: CheckoutInput,
): Promise<CheckoutResult> {
	const merchant = await findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "payments-not-active" };

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
		gatewayPaymentId: created.gatewayPaymentId,
		clientSecret: created.clientSecret,
		publishableKey: merchant.publishableKey,
	};
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

	const status = mapGatewayStatus(gatewayStatus);
	if (status === "succeeded") {
		await fulfill(payment);
	}
	if (status !== payment.status) {
		await pool.query(
			`update payments.payment set status = $2, updated_at = now()
			 where gateway_payment_id = $1`,
			[gatewayPaymentId, status],
		);
	}
	return status;
}

export type WebhookOutcome =
	| { ok: true }
	| { ok: false; reason: "no-merchant" | "bad-signature" | "bad-payload" };

/** Verifies and applies a webhook sent by the gateway for one academy. */
export async function handleWebhook(
	fulfill: FulfillPayment,
	input: { organizationId: string; rawBody: string; signature: string | null },
): Promise<WebhookOutcome> {
	const merchant = await findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "no-merchant" };
	if (
		!isValidSignature(input.rawBody, merchant.webhookSecret, input.signature)
	) {
		return { ok: false, reason: "bad-signature" };
	}

	const event = parseWebhookEvent(input.rawBody);
	if (!event) return { ok: false, reason: "bad-payload" };

	if (event.gatewayPaymentId && event.status) {
		await applyGatewayStatus(fulfill, event.gatewayPaymentId, event.status);
	}
	return { ok: true };
}
