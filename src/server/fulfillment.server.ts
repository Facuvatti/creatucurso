import { enroll } from "../areas/catalog/catalog.ts";
import { findRoles } from "../areas/identity/members.ts";
import type { FulfillPayment } from "../areas/payments/payment.ts";
import { auth } from "./auth.server.ts";

/**
 * Gives the student access once a payment has succeeded. Safe to repeat.
 * The billing gate (trial limit, suspension) ran at checkout, before the
 * payment existed: a payment that went through is always honored (ADR-0029).
 */
export const fulfillPayment: FulfillPayment = async (payment) => {
	const roles = await findRoles(payment.organizationId, payment.userId);
	if (roles.length === 0) {
		await auth.api.addMember({
			body: {
				userId: payment.userId,
				role: "student",
				organizationId: payment.organizationId,
			},
		});
	}
	await enroll({
		courseId: payment.courseId,
		userId: payment.userId,
		source: "payment",
		paymentId: payment.gatewayPaymentId,
	});
};
