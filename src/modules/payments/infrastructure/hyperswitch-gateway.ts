import { randomBytes } from "node:crypto";
import type {
	MerchantCredentials,
	PaymentGateway,
} from "../application/ports.ts";

type Options = {
	baseUrl: string;
	adminApiKey: string;
	fetchImpl?: typeof fetch;
};

export class GatewayError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GatewayError";
	}
}

export function createHyperswitchGateway({
	baseUrl,
	adminApiKey,
	fetchImpl = fetch,
}: Options): PaymentGateway {
	const root = baseUrl.replace(/\/$/, "");

	async function call<T>(
		method: "GET" | "POST",
		path: string,
		apiKey: string,
		body?: unknown,
	): Promise<T> {
		const response = await fetchImpl(`${root}${path}`, {
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

	return {
		async createMerchant({ organizationId, name, webhookUrl }) {
			const merchantId = `cc_${organizationId}`;
			const account = await call<{
				merchant_id: string;
				publishable_key: string;
				default_profile?: string;
			}>("POST", "/accounts", adminApiKey, {
				merchant_id: merchantId,
				merchant_name: name,
			});

			const profileId = account.default_profile;
			if (!profileId) {
				throw new GatewayError(
					500,
					"Hyperswitch did not return a default profile.",
				);
			}

			const key = await call<{ api_key: string }>(
				"POST",
				`/api_keys/${account.merchant_id}`,
				adminApiKey,
				{ name: "creatucurso", description: null, expiration: "never" },
			);

			const webhookSecret = randomBytes(32).toString("hex");
			await call(
				"POST",
				`/account/${account.merchant_id}/business_profile/${profileId}`,
				adminApiKey,
				{
					webhook_details: { webhook_url: webhookUrl },
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
		},

		async addConnector(merchant, { connectorName, apiKey }) {
			await call(
				"POST",
				`/account/${merchant.gatewayMerchantId}/connectors`,
				adminApiKey,
				{
					connector_type: "payment_processor",
					connector_name: connectorName,
					connector_account_details: {
						auth_type: "HeaderKey",
						api_key: apiKey,
					},
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
		},

		async createPayment(merchant, input) {
			const payment = await call<{ payment_id: string; client_secret: string }>(
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
		},

		async retrievePayment(merchant, gatewayPaymentId) {
			const payment = await call<{ status: string }>(
				"GET",
				`/payments/${gatewayPaymentId}`,
				merchant.apiKey,
			);
			return { status: payment.status };
		},
	};
}

export type { MerchantCredentials };
