import { createServerFn } from "@tanstack/react-start";
import {
	academyBillingState,
	type BillingStatus,
	billingConfig,
	choosePlan,
	type InvoiceView,
	isPlan,
	listInvoices,
	monthlyEstimate,
	PLANS,
	type Plan,
	planChoice,
	studentsUsed,
	TRIAL_STUDENT_LIMIT,
} from "../areas/billing/billing.ts";
import {
	billingAvailable,
	findSubscription,
	refreshPreapproval,
	startSubscription,
} from "../areas/billing/subscription.ts";
import { can } from "../areas/identity/permissions.ts";
import { describeError } from "../areas/payments/mercadopago.ts";
import { email, record } from "../shared/validate.ts";
import { requireTenantContext } from "./request.server.ts";

/** Billing is the owner's alone (`billing: manage`). */
async function requireOwnerContext() {
	const context = await requireTenantContext();
	const { user } = context;
	if (!user || !can(context.roles, { billing: ["manage"] })) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return { ...context, user };
}

export type BillingPanel = {
	available: boolean;
	status: BillingStatus;
	trialEndsAt: string;
	trialDaysLeft: number;
	studentsUsed: number;
	studentLimit: number;
	suspendAt: string | null;
	subscription: { status: string; payerEmail: string } | null;
	invoices: InvoiceView[];
	plan: Plan;
	nextPlan: { plan: Plan; from: string } | null;
	plans: {
		id: Plan;
		name: string;
		feePerCourse: number;
		rate: number;
		minPerSale: number;
	}[];
	/** This month so far, priced like its invoice (minor units). */
	estimate: {
		amount: number;
		fee: number;
		commission: number;
		publishedCourses: number;
		salesCount: number;
	};
	currency: string;
	ownerEmail: string;
};

export const getBillingPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<BillingPanel> => {
		const { tenant, user } = await requireOwnerContext();
		let subscription = await findSubscription(tenant.id);
		if (subscription?.status === "pending" && billingAvailable()) {
			// Coming back from Mercado Pago before the webhook: ask the API.
			try {
				await refreshPreapproval(subscription.mpPreapprovalId);
				subscription = await findSubscription(tenant.id);
			} catch (error) {
				console.error(
					"Refreshing the subscription failed",
					describeError(error),
				);
			}
		}
		const state = await academyBillingState(tenant.id);
		const choice = await planChoice(tenant.id);
		const estimate = await monthlyEstimate(tenant.id);
		return {
			available: billingAvailable(),
			status: state.status,
			trialEndsAt: state.trialEndsAt.toISOString(),
			trialDaysLeft: Math.max(
				0,
				Math.ceil((state.trialEndsAt.getTime() - Date.now()) / 86_400_000),
			),
			studentsUsed: await studentsUsed(tenant.id),
			studentLimit: TRIAL_STUDENT_LIMIT,
			suspendAt: state.suspendAt?.toISOString() ?? null,
			subscription: subscription
				? { status: subscription.status, payerEmail: subscription.payerEmail }
				: null,
			invoices: await listInvoices(tenant.id),
			plan: choice.current,
			nextPlan: choice.next,
			plans: (Object.keys(PLANS) as Plan[]).map((id) => ({ id, ...PLANS[id] })),
			estimate: {
				amount: estimate.amount,
				fee: estimate.details.fee,
				commission: estimate.details.commission,
				publishedCourses: estimate.details.publishedCourses,
				salesCount: estimate.details.salesCount,
			},
			currency: billingConfig().currency,
			ownerEmail: user.email,
		};
	},
);

export const startBillingSubscription = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		payerEmail: email(record(data), "payerEmail"),
	}))
	.handler(
		async ({
			data,
		}): Promise<{ ok: true; url: string } | { ok: false; message: string }> => {
			const { tenant, origin } = await requireOwnerContext();
			try {
				const result = await startSubscription({
					organizationId: tenant.id,
					academyName: tenant.name,
					payerEmail: data.payerEmail,
					backUrl: `${origin}/panel/facturacion?mp=vuelta`,
				});
				if (result.ok) return result;
				return {
					ok: false,
					message:
						result.reason === "active"
							? "La suscripción ya está activa."
							: "Las suscripciones todavía no están disponibles en esta instalación.",
				};
			} catch (error) {
				console.error("Starting the subscription failed", describeError(error));
				return {
					ok: false,
					message:
						"No pudimos crear la suscripción en Mercado Pago. Probá de nuevo más tarde.",
				};
			}
		},
	);

export const chooseBillingPlan = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const plan = record(data).plan;
		if (!isPlan(plan)) throw new Error("Elegí un plan válido.");
		return { plan };
	})
	.handler(
		async ({
			data,
		}): Promise<{ ok: true } | { ok: false; message: string }> => {
			const { tenant } = await requireOwnerContext();
			await choosePlan(tenant.id, data.plan);
			return { ok: true };
		},
	);
