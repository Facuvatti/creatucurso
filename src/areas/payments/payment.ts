import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type Provider = "hyperswitch" | "mercadopago";

/** Translates the payment gateway's status into the three states we care about. */
export function mapGatewayStatus(status: string): PaymentStatus {
	switch (status) {
		case "succeeded":
			return "succeeded";
		case "failed":
		case "cancelled":
		case "expired":
			return "failed";
		default:
			return "pending";
	}
}

/** Checks the HMAC-SHA512 signature the gateway puts on each webhook. */
export function isValidSignature(
	rawBody: string,
	secret: string,
	signature: string | null,
): boolean {
	if (!signature) return false;
	const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
	const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
	const wanted = Buffer.from(expected, "utf8");
	return received.length === wanted.length && timingSafeEqual(received, wanted);
}

export type CoursePrice = { amount: number; currency: string };

/** A course is paid when it has a positive price and a currency. */
export function priceOf(course: {
	priceAmount: number | null;
	currency: string | null;
}): CoursePrice | null {
	if (!course.priceAmount || course.priceAmount <= 0 || !course.currency) {
		return null;
	}
	return { amount: course.priceAmount, currency: course.currency };
}

export type MerchantCredentials = {
	organizationId: string;
	provider: Provider;
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
	provider: Provider;
	gatewayPaymentId: string;
	providerPaymentId: string | null;
	amount: number;
	currency: string;
	refundedAmount: number;
	status: PaymentStatus;
};

export type PaymentRow = {
	id: string;
	organization_id: string;
	course_id: string;
	user_id: string;
	provider: Provider;
	gateway_payment_id: string;
	provider_payment_id: string | null;
	amount: number;
	currency: string;
	refunded_amount: number;
	status: PaymentStatus;
};

/** Columns that `toPaymentRecord` reads. */
export const PAYMENT_COLUMNS =
	"id, organization_id, course_id, user_id, provider, gateway_payment_id, provider_payment_id, amount, currency, refunded_amount, status";

export function toPaymentRecord(row: PaymentRow): PaymentRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		courseId: row.course_id,
		userId: row.user_id,
		provider: row.provider,
		gatewayPaymentId: row.gateway_payment_id,
		providerPaymentId: row.provider_payment_id,
		amount: row.amount,
		currency: row.currency,
		refundedAmount: row.refunded_amount,
		status: row.status,
	};
}

/** What has to happen once a payment succeeds (enrol the student). Must be safe to repeat. */
export type FulfillPayment = (payment: PaymentRecord) => Promise<void>;

export type WebhookEvent = {
	type: string | null;
	gatewayPaymentId: string | null;
	status: string | null;
	refundId: string | null;
	refundAmount: number | null;
	disputeId: string | null;
};

/**
 * Checks the webhook body sent by the gateway and returns what we use from it,
 * or null when it is not JSON. Fields we do not need are ignored.
 */
export function parseWebhookEvent(rawBody: string): WebhookEvent | null {
	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return null;
	}
	if (typeof body !== "object" || body === null) return null;
	const { event_type: type, content } = body as {
		event_type?: unknown;
		content?: { object?: Record<string, unknown> };
	};
	const object = content?.object;
	const text = (value: unknown) => (typeof value === "string" ? value : null);
	const amount = object?.refund_amount ?? object?.amount;
	return {
		type: text(type),
		gatewayPaymentId: text(object?.payment_id),
		status: text(object?.status),
		refundId: text(object?.refund_id),
		refundAmount: typeof amount === "number" ? amount : null,
		disputeId: text(object?.dispute_id),
	};
}
