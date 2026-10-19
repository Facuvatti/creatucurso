import type { FulfillPayment } from "../modules/payments/application/ports.ts";
import { auth } from "./auth.server.ts";
import { getCatalog, getMembershipReader } from "./container.server.ts";

/** Gives the student access once a payment has succeeded. Safe to repeat. */
export const fulfillPayment: FulfillPayment = async (payment) => {
	const roles = await getMembershipReader().findRoles(
		payment.organizationId,
		payment.userId,
	);
	if (roles.length === 0) {
		await auth.api.addMember({
			body: {
				userId: payment.userId,
				role: "student",
				organizationId: payment.organizationId,
			},
		});
	}
	await getCatalog().enroll({
		courseId: payment.courseId,
		userId: payment.userId,
		source: "payment",
		paymentId: payment.gatewayPaymentId,
	});
};
