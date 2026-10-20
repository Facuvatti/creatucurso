import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentStatus = "pending" | "succeeded" | "failed";

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

/** What has to happen once a payment succeeds (enrol the student). Must be safe to repeat. */
export type FulfillPayment = (payment: PaymentRecord) => Promise<void>;

/**
 * Checks the webhook body sent by the gateway and returns what we use from it,
 * or null when it is not JSON. Fields we do not need are ignored.
 */
export function parseWebhookEvent(
	rawBody: string,
): { gatewayPaymentId: string | null; status: string | null } | null {
	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		return null;
	}
	if (typeof body !== "object" || body === null) return null;
	const content = (body as { content?: { object?: Record<string, unknown> } })
		.content;
	const object = content?.object;
	return {
		gatewayPaymentId:
			typeof object?.payment_id === "string" ? object.payment_id : null,
		status: typeof object?.status === "string" ? object.status : null,
	};
}
