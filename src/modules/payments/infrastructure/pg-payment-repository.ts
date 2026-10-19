import type { Pool } from "pg";
import type {
	MerchantCredentials,
	PaymentRecord,
	PaymentRepository,
} from "../application/ports.ts";
import type { PaymentStatus } from "../domain/payment.ts";

type SecretBox = {
	encrypt: (plain: string) => string;
	decrypt: (box: string) => string;
};

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

export function createPgPaymentRepository(
	pool: Pool,
	secrets: SecretBox,
): PaymentRepository {
	return {
		async findMerchant(organizationId) {
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
				apiKey: secrets.decrypt(row.api_key_encrypted),
				webhookSecret: secrets.decrypt(row.webhook_secret_encrypted),
			} satisfies MerchantCredentials;
		},

		async saveMerchant(merchant) {
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
					secrets.encrypt(merchant.apiKey),
					secrets.encrypt(merchant.webhookSecret),
				],
			);
		},

		async createPayment(payment) {
			await pool.query(
				`insert into payments.payment
				 (organization_id, course_id, user_id, gateway_payment_id, amount, currency)
				 values ($1, $2, $3, $4, $5, $6)`,
				[
					payment.organizationId,
					payment.courseId,
					payment.userId,
					payment.gatewayPaymentId,
					payment.amount,
					payment.currency,
				],
			);
		},

		async findByGatewayId(gatewayPaymentId) {
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
			} satisfies PaymentRecord;
		},

		async setStatus(gatewayPaymentId, status) {
			await pool.query(
				`update payments.payment set status = $2, updated_at = now()
				 where gateway_payment_id = $1`,
				[gatewayPaymentId, status],
			);
		},
	};
}
