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
