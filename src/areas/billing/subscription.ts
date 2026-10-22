// The academy pays the platform with one Mercado Pago subscription (preapproval
// without a plan) of the PLATFORM account. Its amount is kept equal to what the
// academy owes (open and failed invoices) and it is paused while nothing is
// owed, so each monthly charge takes exactly the last close (ADR-0029).
import { inTransaction, pool } from "../../server/db.server.ts";
import {
	createPreapproval,
	getAuthorizedPayment,
	getPreapproval,
	isValidSignature,
	updatePreapproval,
} from "../payments/mercadopago.ts";
import {
	academyBillingState,
	billingConfig,
	forgetBillingState,
	monthlyEstimate,
} from "./billing.ts";

/** Both the platform token and the secret of its webhooks are needed. */
export function billingAvailable(): boolean {
	return !!(
		process.env.MP_PLATFORM_ACCESS_TOKEN &&
		process.env.MP_PLATFORM_WEBHOOK_SECRET
	);
}

type SubscriptionStatus = "pending" | "authorized" | "paused" | "cancelled";

export type SubscriptionView = {
	mpPreapprovalId: string;
	status: SubscriptionStatus;
	payerEmail: string;
	chargeAmount: number | null;
};

export async function findSubscription(
	organizationId: string,
): Promise<SubscriptionView | null> {
	const { rows } = await pool.query<{
		mp_preapproval_id: string;
		status: SubscriptionStatus;
		payer_email: string;
		charge_amount: string | null;
	}>(
		`select mp_preapproval_id, status, payer_email, charge_amount
		 from billing.subscription where organization_id = $1`,
		[organizationId],
	);
	const row = rows[0];
	return row
		? {
				mpPreapprovalId: row.mp_preapproval_id,
				status: row.status,
				payerEmail: row.payer_email,
				chargeAmount:
					row.charge_amount === null ? null : Number(row.charge_amount),
			}
		: null;
}

/** Open and failed invoices, in minor units. */
export async function amountDue(organizationId: string): Promise<number> {
	const { rows } = await pool.query<{ due: string }>(
		`select coalesce(sum(amount), 0)::text as due from billing.invoice
		 where organization_id = $1 and status in ('open', 'failed')`,
		[organizationId],
	);
	return Number(rows[0]?.due ?? 0);
}

/** Charges land on the 2nd of the month at 12:00 UTC, after the close of the 1st. */
function nextBillingDate(after: Date): Date {
	return new Date(
		Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 2, 12),
	);
}

/** Never charged: the close sets the real amount (or pauses) before the first charge date. */
const PLACEHOLDER_MINOR = 100_00;

/**
 * Creates the preapproval and returns Mercado Pago's page where the owner
 * authorizes it. With money owed, the first charge happens right away;
 * otherwise it starts on the next billing date after the trial.
 */
export async function startSubscription(input: {
	organizationId: string;
	academyName: string;
	payerEmail: string;
	backUrl: string;
}): Promise<
	{ ok: true; url: string } | { ok: false; reason: "active" | "unavailable" }
> {
	if (!billingAvailable()) return { ok: false, reason: "unavailable" };
	const current = await findSubscription(input.organizationId);
	if (current?.status === "authorized" || current?.status === "paused") {
		return { ok: false, reason: "active" };
	}
	const config = billingConfig();
	const due = await amountDue(input.organizationId);
	const state = await academyBillingState(input.organizationId);
	const now = new Date();
	const created = await createPreapproval({
		organizationId: input.organizationId,
		reason: `Creatucurso: suscripción de ${input.academyName}`.slice(0, 120),
		payerEmail: input.payerEmail,
		amount:
			due > 0
				? due
				: Math.max(
						(await monthlyEstimate(input.organizationId)).amount,
						PLACEHOLDER_MINOR,
					),
		currency: config.currency,
		backUrl: input.backUrl,
		startDate:
			due > 0
				? null
				: nextBillingDate(state.trialEndsAt > now ? state.trialEndsAt : now),
	});
	if (current && current.mpPreapprovalId !== created.id) {
		// The previous attempt was never authorized: close it so it cannot be used later.
		await updatePreapproval(current.mpPreapprovalId, {
			status: "cancelled",
		}).catch(() => undefined);
	}
	// lapsed_at is kept: a new pending attempt does not restart the past-due clock.
	await pool.query(
		`insert into billing.subscription (organization_id, mp_preapproval_id, status, payer_email)
		 values ($1, $2, 'pending', $3)
		 on conflict (organization_id) do update set
		   mp_preapproval_id = excluded.mp_preapproval_id, status = 'pending',
		   payer_email = excluded.payer_email, charge_amount = null, updated_at = now()`,
		[input.organizationId, created.id, input.payerEmail],
	);
	forgetBillingState(input.organizationId);
	return { ok: true, url: created.initPoint };
}

/**
 * Makes the next charge take what is owed: sets the amount (and resumes) when
 * something is owed, pauses when nothing is.
 */
export async function syncSubscription(organizationId: string): Promise<void> {
	const subscription = await findSubscription(organizationId);
	if (
		subscription?.status !== "authorized" &&
		subscription?.status !== "paused"
	) {
		return;
	}
	const due = await amountDue(organizationId);
	let status: SubscriptionStatus = subscription.status;
	if (due > 0) {
		await updatePreapproval(subscription.mpPreapprovalId, {
			amount: { value: due, currency: billingConfig().currency },
			...(status === "paused" ? { status: "authorized" as const } : {}),
		});
		status = "authorized";
	} else if (status === "authorized") {
		await updatePreapproval(subscription.mpPreapprovalId, { status: "paused" });
		status = "paused";
	}
	await pool.query(
		`update billing.subscription set status = $2, charge_amount = $3, updated_at = now()
		 where organization_id = $1`,
		[organizationId, status, due],
	);
}

/** Subscriptions whose next charge does not match what is owed (after a close, a payment or a failed sync). */
export async function syncPendingSubscriptions(): Promise<void> {
	const { rows } = await pool.query<{ organization_id: string }>(
		`select s.organization_id from billing.subscription s
		 where s.status in ('authorized', 'paused')
		   and s.charge_amount is distinct from (
		     select coalesce(sum(i.amount), 0) from billing.invoice i
		     where i.organization_id = s.organization_id and i.status in ('open', 'failed'))`,
	);
	for (const row of rows) {
		try {
			await syncSubscription(row.organization_id);
		} catch (error) {
			// Ids and the error name only; retried on the next run.
			console.error(
				JSON.stringify({
					level: "error",
					msg: "billing subscription sync failed",
					organizationId: row.organization_id,
					error: error instanceof Error ? error.message : "unknown",
				}),
			);
		}
	}
}

const KNOWN_STATUSES = new Set([
	"pending",
	"authorized",
	"paused",
	"cancelled",
]);

/** Re-reads a preapproval from Mercado Pago and stores its status. */
export async function refreshPreapproval(preapprovalId: string): Promise<void> {
	const preapproval = await getPreapproval(preapprovalId);
	if (!KNOWN_STATUSES.has(preapproval.status)) return;
	const { rows } = await pool.query<{ organization_id: string }>(
		`update billing.subscription set status = $2, updated_at = now(),
		   lapsed_at = case when $2 = 'cancelled' then coalesce(lapsed_at, now())
		                    when $2 = 'authorized' then null else lapsed_at end
		 where mp_preapproval_id = $1 and status <> $2
		 returning organization_id`,
		[String(preapproval.id), preapproval.status],
	);
	const organizationId = rows[0]?.organization_id;
	if (!organizationId) return;
	forgetBillingState(organizationId);
	if (preapproval.status === "authorized") {
		await syncSubscription(organizationId);
	}
}

/**
 * Records one recurring charge as Mercado Pago reports it. An approved charge
 * pays the oldest unpaid invoices it covers, once (applied_at); a rejected one
 * (Mercado Pago retries it: status recycling) marks the open invoices failed.
 */
export async function recordCharge(authorizedPaymentId: string): Promise<void> {
	const charge = await getAuthorizedPayment(authorizedPaymentId);
	const { rows: owner } = await pool.query<{ organization_id: string }>(
		"select organization_id from billing.subscription where mp_preapproval_id = $1",
		[String(charge.preapproval_id)],
	);
	const organizationId = owner[0]?.organization_id;
	if (!organizationId) return;
	const id = String(charge.id);
	const amount = Math.round(charge.transaction_amount * 100);
	const paymentStatus = charge.payment?.status ?? null;
	const outcome =
		paymentStatus === "approved"
			? "approved"
			: charge.status === "recycling" ||
					paymentStatus === "rejected" ||
					paymentStatus === "cancelled"
				? "failed"
				: "pending";

	const applied = await inTransaction(async (client) => {
		await client.query(
			`insert into billing.subscription_charge (mp_authorized_payment_id, organization_id, status, amount)
			 values ($1, $2, $3, $4)
			 on conflict (mp_authorized_payment_id) do update set
			   status = excluded.status, amount = excluded.amount, updated_at = now()`,
			[id, organizationId, outcome, amount],
		);
		const { rows } = await client.query<{ applied_at: Date | null }>(
			"select applied_at from billing.subscription_charge where mp_authorized_payment_id = $1 for update",
			[id],
		);
		if (outcome === "failed") {
			await client.query(
				`update billing.invoice set status = 'failed', failed_at = coalesce(failed_at, now())
				 where organization_id = $1 and status = 'open'`,
				[organizationId],
			);
			return false;
		}
		if (outcome !== "approved" || rows[0]?.applied_at) return false;
		const { rows: unpaid } = await client.query<{ id: string; amount: string }>(
			`select id, amount from billing.invoice
			 where organization_id = $1 and status in ('open', 'failed')
			 order by period for update`,
			[organizationId],
		);
		let left = amount;
		const paid: string[] = [];
		for (const invoice of unpaid) {
			if (Number(invoice.amount) > left) break;
			left -= Number(invoice.amount);
			paid.push(invoice.id);
		}
		if (paid.length > 0) {
			await client.query(
				`update billing.invoice set status = 'paid', paid_at = now(), failed_at = null,
				   details = details || jsonb_build_object('mpAuthorizedPaymentId', $2::text)
				 where id = any ($1::uuid[])`,
				[paid, id],
			);
		}
		if (left > 0) {
			// More than what was owed (should not happen while the amount is kept in sync).
			console.error(
				JSON.stringify({
					level: "error",
					msg: "billing charge left unapplied",
					organizationId,
					authorizedPaymentId: id,
					unapplied: left,
				}),
			);
		}
		await client.query(
			"update billing.subscription_charge set applied_at = now() where mp_authorized_payment_id = $1",
			[id],
		);
		return true;
	});
	forgetBillingState(organizationId);
	if (applied) await syncSubscription(organizationId);
}

export type BillingWebhookOutcome =
	| { ok: true }
	| { ok: false; reason: "not-configured" | "bad-signature" | "bad-request" };

/**
 * The webhook of the platform's subscriptions application. The body is never
 * trusted: the preapproval or the charge is fetched with the platform token.
 */
export async function handleBillingWebhook(input: {
	topic: string | null;
	dataId: string | null;
	signature: string | null;
	requestId: string | null;
}): Promise<BillingWebhookOutcome> {
	const secret = process.env.MP_PLATFORM_WEBHOOK_SECRET;
	if (!secret || !process.env.MP_PLATFORM_ACCESS_TOKEN) {
		return { ok: false, reason: "not-configured" };
	}
	if (
		!isValidSignature({
			signature: input.signature,
			requestId: input.requestId,
			dataId: input.dataId,
			secret,
		})
	) {
		return { ok: false, reason: "bad-signature" };
	}
	if (!input.dataId) return { ok: false, reason: "bad-request" };
	if (
		input.topic === "subscription_preapproval" ||
		input.topic === "preapproval"
	) {
		await refreshPreapproval(input.dataId);
	} else if (
		input.topic === "subscription_authorized_payment" ||
		input.topic === "authorized_payment"
	) {
		await recordCharge(input.dataId);
	}
	// Other topics (plans, payments) are not used for billing.
	return { ok: true };
}
