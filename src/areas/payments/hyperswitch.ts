import { randomBytes } from "node:crypto";
import type { MerchantCredentials } from "./payment.ts";

/** How to reach Hyperswitch with the platform's admin key. */
export type GatewayConfig = { gatewayUrl: string; adminApiKey: string };

export class GatewayError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GatewayError";
	}
}

async function call<T>(
	gatewayUrl: string,
	method: "GET" | "POST",
	path: string,
	apiKey: string,
	body?: unknown,
): Promise<T> {
	const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}${path}`, {
		method,
		headers: { "api-key": apiKey, "content-type": "application/json" },
		body: body === undefined ? null : JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new GatewayError(
			response.status,
			`Hyperswitch ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`,
		);
	}
	return JSON.parse(text) as T;
}

/** Creates the merchant account of an academy with its API key and webhook. */
export async function createMerchant(
	{ gatewayUrl, adminApiKey }: GatewayConfig,
	input: { organizationId: string; name: string; webhookUrl: string },
): Promise<Omit<MerchantCredentials, "organizationId">> {
	const account = await call<{
		merchant_id: string;
		publishable_key: string;
		default_profile?: string;
	}>(gatewayUrl, "POST", "/accounts", adminApiKey, {
		merchant_id: `cc_${input.organizationId}`,
		merchant_name: input.name,
	});

	const profileId = account.default_profile;
	if (!profileId) {
		throw new GatewayError(
			500,
			"Hyperswitch did not return a default profile.",
		);
	}

	const key = await call<{ api_key: string }>(
		gatewayUrl,
		"POST",
		`/api_keys/${account.merchant_id}`,
		adminApiKey,
		{ name: "creatucurso", description: null, expiration: "never" },
	);

	const webhookSecret = randomBytes(32).toString("hex");
	await call(
		gatewayUrl,
		"POST",
		`/account/${account.merchant_id}/business_profile/${profileId}`,
		adminApiKey,
		{
			webhook_details: { webhook_url: input.webhookUrl },
			payment_response_hash_key: webhookSecret,
		},
	);

	return {
		gatewayMerchantId: account.merchant_id,
		gatewayProfileId: profileId,
		publishableKey: account.publishable_key,
		apiKey: key.api_key,
		webhookSecret,
	};
}

export async function addConnector(
	{ gatewayUrl, adminApiKey }: GatewayConfig,
	merchant: MerchantCredentials,
	{ connectorName, apiKey }: { connectorName: string; apiKey: string },
): Promise<void> {
	await call(
		gatewayUrl,
		"POST",
		`/account/${merchant.gatewayMerchantId}/connectors`,
		adminApiKey,
		{
			connector_type: "payment_processor",
			connector_name: connectorName,
			connector_account_details: { auth_type: "HeaderKey", api_key: apiKey },
			profile_id: merchant.gatewayProfileId,
			test_mode: false,
			disabled: false,
			payment_methods_enabled: [
				{
					payment_method: "card",
					payment_method_types: [
						{
							payment_method_type: "credit",
							card_networks: ["Visa", "Mastercard"],
						},
						{
							payment_method_type: "debit",
							card_networks: ["Visa", "Mastercard"],
						},
					],
				},
			],
		},
	);
}

export async function createGatewayPayment(
	{ gatewayUrl }: GatewayConfig,
	merchant: MerchantCredentials,
	input: {
		amount: number;
		currency: string;
		description: string;
		returnUrl: string;
		customerId: string;
		metadata: Record<string, string>;
	},
): Promise<{ gatewayPaymentId: string; clientSecret: string }> {
	const payment = await call<{ payment_id: string; client_secret: string }>(
		gatewayUrl,
		"POST",
		"/payments",
		merchant.apiKey,
		{
			amount: input.amount,
			currency: input.currency,
			confirm: false,
			capture_method: "automatic",
			customer_id: input.customerId,
			description: input.description,
			return_url: input.returnUrl,
			profile_id: merchant.gatewayProfileId,
			metadata: input.metadata,
		},
	);
	return {
		gatewayPaymentId: payment.payment_id,
		clientSecret: payment.client_secret,
	};
}

export async function retrieveGatewayPayment(
	{ gatewayUrl }: GatewayConfig,
	merchant: MerchantCredentials,
	gatewayPaymentId: string,
): Promise<{ status: string }> {
	const payment = await call<{ status: string }>(
		gatewayUrl,
		"GET",
		`/payments/${gatewayPaymentId}`,
		merchant.apiKey,
	);
	return { status: payment.status };
}
