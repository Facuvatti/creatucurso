import type { PoolClient } from "pg";
import { emitEvent, inTransaction, pool } from "../../server/db.server.ts";
import { hideReviewForRefund, restoreReviewAfterRefund } from "../community/community.ts";
import { revokeForEnrollment } from "../certificates/certificates.ts";
import {
	findEnrollment,
	lessonProgress,
	setEnrollmentStatus,
} from "../catalog/catalog.ts";
import {
	PAYMENT_COLUMNS,
	type PaymentRecord,
	type PaymentRow,
	toPaymentRecord,
} from "./payment.ts";

const REFUND_WINDOW_DAYS = 10;
const REFUND_MAX_PROGRESS = 0.1;

// ------------------------------------------------------------------- effects

/**
 * Stores a refund (once per provider refund id) and applies its effect: the
 * payment becomes `refunded` when fully refunded, and then the student loses
 * access. A partial refund changes nothing else. Safe to repeat.
 * The student's review is hidden in the same transaction.
 */
export async function recordRefund(
	payment: PaymentRecord,
	refund: {
		providerRefundId: string;
		amount: number;
		requestedBy: "student" | "tenant" | "provider";
	},
): Promise<boolean> {
	if (refund.amount <= 0) return false;
	return inTransaction(async (client) => {
		const inserted = await client.query(
			`insert into payments.refund (payment_id, provider_refund_id, amount, requested_by)
			 values ($1, $2, $3, $4) on conflict do nothing returning id`,
			[payment.id, refund.providerRefundId, refund.amount, refund.requestedBy],
		);
		if (!inserted.rows[0]) return false;

		const updated = await client.query<{
			amount: number;
			refunded_amount: number;
		}>(
			`update payments.payment
			 set refunded_amount = least(refunded_amount + $2, amount),
			     status = case when refunded_amount + $2 >= amount then 'refunded' else status end,
			     updated_at = now()
			 where id = $1 returning amount, refunded_amount`,
			[payment.id, refund.amount],
		);
		const total = updated.rows[0];
		if (total && total.refunded_amount >= total.amount) {
			const enrollmentId = await setEnrollmentStatus(client, {
				courseId: payment.courseId,
				userId: payment.userId,
				from: ["active", "suspended"],
				to: "refunded",
			});
			if (enrollmentId) {
				await hideReviewForRefund(client, payment.courseId, payment.userId);
				await revokeForEnrollment(client, payment.courseId, payment.userId, "refunded");
				await emitEvent(
					client,
					"enrollment.refunded",
					{
						enrollmentId,
						courseId: payment.courseId,
						userId: payment.userId,
						paymentId: payment.id,
					},
					`enrollment.refunded:${enrollmentId}:${payment.id}`,
				);
			}
		}
		return true;
	});
}

export type DisputeStatus = "open" | "won" | "lost";

/**
 * Stores a dispute transition and applies it: opened suspends access, lost
 * revokes it, won restores it. Won and lost are final. Safe to repeat.
 */
export async function recordDispute(
	payment: PaymentRecord,
	dispute: { providerDisputeId: string; status: DisputeStatus },
): Promise<boolean> {
	return inTransaction(async (client: PoolClient) => {
		const previous = await client.query<{ status: DisputeStatus }>(
			`select status from payments.dispute
			 where payment_id = $1 and provider_dispute_id = $2 for update`,
			[payment.id, dispute.providerDisputeId],
		);
		const before = previous.rows[0]?.status;
		if (before === dispute.status || before === "won" || before === "lost") {
			return false;
		}
		await client.query(
			`insert into payments.dispute (payment_id, provider_dispute_id, status)
			 values ($1, $2, $3)
			 on conflict (payment_id, provider_dispute_id)
			 do update set status = excluded.status, updated_at = now()`,
			[payment.id, dispute.providerDisputeId, dispute.status],
		);

		const move =
			dispute.status === "open"
				? { from: ["active" as const], to: "suspended" as const }
				: dispute.status === "lost"
					? {
							from: ["active" as const, "suspended" as const],
							to: "revoked" as const,
						}
					: { from: ["suspended" as const], to: "active" as const };
		const moved = await setEnrollmentStatus(client, {
			courseId: payment.courseId,
			userId: payment.userId,
			...move,
		});
		if (moved && move.to === "revoked") {
			await revokeForEnrollment(client, payment.courseId, payment.userId, "refunded");
		}
		if (moved && move.to === "active") {
			await restoreReviewAfterRefund(client, payment.courseId, payment.userId);
		}
		await emitEvent(
			client,
			`dispute.${dispute.status === "open" ? "opened" : dispute.status}`,
			{
				paymentId: payment.id,
				courseId: payment.courseId,
				userId: payment.userId,
				providerDisputeId: dispute.providerDisputeId,
			},
			`dispute.${dispute.status}:${payment.id}:${dispute.providerDisputeId}`,
		);
		return true;
	});
}

export async function hasDispute(paymentId: string): Promise<boolean> {
	const { rowCount } = await pool.query(
		"select 1 from payments.dispute where payment_id = $1",
		[paymentId],
	);
	return (rowCount ?? 0) > 0;
}

// ------------------------------------------------------------- student rule

/**
 * The payment a student may refund by themselves: bought less than 10 days
 * ago with less than 10% of the lessons completed. Computed on the server.
 */
export async function findSelfRefundablePayment(
	courseId: string,
	userId: string,
): Promise<PaymentRecord | null> {
	const enrollment = await findEnrollment(courseId, userId);
	if (!enrollment) return null;
	const ageDays = (Date.now() - enrollment.createdAt.getTime()) / 86_400_000;
	if (ageDays > REFUND_WINDOW_DAYS) return null;

	const { done, total } = await lessonProgress(courseId, userId);
	if (total > 0 && done / total >= REFUND_MAX_PROGRESS) return null;

	const { rows } = await pool.query<PaymentRow>(
		`select ${PAYMENT_COLUMNS} from payments.payment
		 where course_id = $1 and user_id = $2 and status = 'succeeded' and refunded_amount = 0
		 order by created_at desc limit 1`,
		[courseId, userId],
	);
	return rows[0] ? toPaymentRecord(rows[0]) : null;
}

// --------------------------------------------------------------------- panel

export type PanelPayment = {
	id: string;
	courseName: string;
	studentEmail: string;
	amount: number;
	refundedAmount: number;
	currency: string;
	status: string;
	createdAt: string;
};

export type PanelRefund = {
	id: string;
	courseName: string;
	studentEmail: string;
	amount: number;
	currency: string;
	requestedBy: string;
	createdAt: string;
};

/** Recent payments and refunds of an academy, for the payments panel. */
export async function listPanelPayments(organizationId: string): Promise<{
	payments: PanelPayment[];
	refunds: PanelRefund[];
}> {
	const payments = await pool.query<{
		id: string;
		name: string;
		email: string;
		amount: number;
		refunded_amount: number;
		currency: string;
		status: string;
		created_at: Date;
	}>(
		`select p.id, c.name, u.email, p.amount, p.refunded_amount, p.currency, p.status, p.created_at
		 from payments.payment p
		 join catalog.course c on c.id = p.course_id
		 join auth."user" u on u.id = p.user_id
		 where p.organization_id = $1 and p.status in ('succeeded', 'refunded')
		 order by p.created_at desc limit 50`,
		[organizationId],
	);
	const refunds = await pool.query<{
		id: string;
		name: string;
		email: string;
		amount: number;
		currency: string;
		requested_by: string;
		created_at: Date;
	}>(
		`select r.id, c.name, u.email, r.amount, p.currency, r.requested_by, r.created_at
		 from payments.refund r
		 join payments.payment p on p.id = r.payment_id
		 join catalog.course c on c.id = p.course_id
		 join auth."user" u on u.id = p.user_id
		 where p.organization_id = $1
		 order by r.created_at desc limit 50`,
		[organizationId],
	);
	return {
		payments: payments.rows.map((r) => ({
			id: r.id,
			courseName: r.name,
			studentEmail: r.email,
			amount: r.amount,
			refundedAmount: r.refunded_amount,
			currency: r.currency,
			status: r.status,
			createdAt: r.created_at.toISOString(),
		})),
		refunds: refunds.rows.map((r) => ({
			id: r.id,
			courseName: r.name,
			studentEmail: r.email,
			amount: r.amount,
			currency: r.currency,
			requestedBy: r.requested_by,
			createdAt: r.created_at.toISOString(),
		})),
	};
}
