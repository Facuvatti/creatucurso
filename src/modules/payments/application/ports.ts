import type { PaymentStatus } from "../domain/payment.ts";

export type MerchantCredentials = {
	organizationId: string;
	gatewayMerchantId: string;
	gatewayProfileId: string;
	publishableKey: string;
	apiKey: string;
	webhookSecret: string;
};

export type PaymentRecord = {
	id: string;
	organizationId: string;
	courseId: string;
	userId: string;
	gatewayPaymentId: string;
	amount: number;
	currency: string;
	status: PaymentStatus;
};

export interface PaymentGateway {
	createMerchant(input: {
		organizationId: string;
		name: string;
		webhookUrl: string;
	}): Promise<Omit<MerchantCredentials, "organizationId">>;

	addConnector(
		merchant: MerchantCredentials,
		input: { connectorName: string; apiKey: string },
	): Promise<void>;

	createPayment(
		merchant: MerchantCredentials,
		input: {
			amount: number;
			currency: string;
			description: string;
			returnUrl: string;
			customerId: string;
			metadata: Record<string, string>;
		},
	): Promise<{ gatewayPaymentId: string; clientSecret: string }>;

	retrievePayment(
		merchant: MerchantCredentials,
		gatewayPaymentId: string,
	): Promise<{ status: string }>;
}

export interface PaymentRepository {
	findMerchant(organizationId: string): Promise<MerchantCredentials | null>;
	saveMerchant(merchant: MerchantCredentials): Promise<void>;
	createPayment(payment: Omit<PaymentRecord, "id" | "status">): Promise<void>;
	findByGatewayId(gatewayPaymentId: string): Promise<PaymentRecord | null>;
	setStatus(gatewayPaymentId: string, status: PaymentStatus): Promise<void>;
}

/** What has to happen once a payment succeeds (enrol the student). Must be safe to repeat. */
export type FulfillPayment = (payment: PaymentRecord) => Promise<void>;
