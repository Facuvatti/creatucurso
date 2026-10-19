import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	activatePayments,
	applyGatewayStatus,
	startCheckout,
} from "../modules/payments/application/payments-service.ts";
import { priceOf } from "../modules/payments/domain/payment.ts";
import { auth } from "./auth.server.ts";
import { getCatalog, getPayments } from "./container.server.ts";
import { fulfillPayment } from "./fulfillment.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };

const NOT_CONFIGURED =
	"Los cobros no están configurados en esta instalación todavía.";

// ---------------------------------------------------------------- creator side

export type PaymentsPanel = {
	available: boolean;
	active: boolean;
	testConnectors: boolean;
};

export const getPaymentsPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<PaymentsPanel> => {
		const { tenant } = await requireStaffContext();
		const payments = getPayments();
		return {
			available: payments !== null,
			active: payments
				? (await payments.repository.findMerchant(tenant.id)) !== null
				: false,
			testConnectors: process.env.NODE_ENV !== "production",
		};
	},
);

export const activateAcademyPayments = createServerFn({
	method: "POST",
}).handler(async (): Promise<Result> => {
	const { tenant } = await requireStaffContext();
	const payments = getPayments();
	if (!payments) return { ok: false, message: NOT_CONFIGURED };

	await activatePayments(payments, {
		organizationId: tenant.id,
		name: tenant.name,
		webhookUrl: `${payments.webhookBaseUrl}/api/webhooks/hyperswitch/${tenant.id}`,
	});
	return { ok: true };
});

const connectInput = z.object({
	connectorName: z.string().regex(/^[a-z0-9_]{2,40}$/),
	apiKey: z.string().trim().min(8).max(500),
});

export const connectPaymentProvider = createServerFn({ method: "POST" })
	.validator((data: unknown) => connectInput.parse(data))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const payments = getPayments();
		if (!payments) return { ok: false, message: NOT_CONFIGURED };

		const merchant = await payments.repository.findMerchant(tenant.id);
		if (!merchant) {
			return {
				ok: false,
				message: "Primero activá los cobros de tu academia.",
			};
		}
		try {
			await payments.gateway.addConnector(merchant, data);
			return { ok: true };
		} catch (error) {
			console.error("Connecting the payment provider failed", error);
			return {
				ok: false,
				message:
					"No pudimos conectar ese proveedor. Revisá los datos e intentá de nuevo.",
			};
		}
	});

const priceInput = z.object({
	courseId: z.string().uuid(),
	price: z.number().min(0).max(10_000_000).nullable(),
	currency: z.enum(["ARS", "USD", "EUR", "BRL", "MXN", "CLP", "COP", "UYU"]),
});

export const setCoursePrice = createServerFn({ method: "POST" })
	.validator((data: unknown) => priceInput.parse(data))
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const amount = data.price === null ? 0 : Math.round(data.price * 100);
		const saved = await getCatalog().setPrice(
			tenant.id,
			data.courseId,
			amount > 0 ? { amount, currency: data.currency } : null,
		);
		return saved
			? { ok: true }
			: { ok: false, message: "No encontramos el curso." };
	});

// ---------------------------------------------------------------- student side

const courseInput = z.object({ courseSlug: z.string().min(1).max(200) });

async function findPublishedCourse(organizationId: string, slug: string) {
	const lookup = await getCatalog().findBySlug(organizationId, slug);
	return lookup?.kind === "found" && lookup.course.status === "published"
		? lookup.course
		: null;
}

export type CheckoutSession =
	| {
			ok: true;
			paymentId: string;
			clientSecret: string;
			publishableKey: string;
			sdkUrl: string;
			backendUrl: string;
			returnUrl: string;
	  }
	| { ok: false; message: string };

export const startCourseCheckout = createServerFn({ method: "POST" })
	.validator((data: unknown) => courseInput.parse(data))
	.handler(async ({ data }): Promise<CheckoutSession> => {
		const context = await requireTenantContext();
		const { user, tenant } = context;
		if (!user)
			return { ok: false, message: "Ingresá para comprar este curso." };

		const course = await findPublishedCourse(tenant.id, data.courseSlug);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		const price = priceOf(course);
		if (!price) return { ok: false, message: "Este curso es gratuito." };
		if (await getCatalog().findEnrollment(course.id, user.id)) {
			return { ok: false, message: "Ya estás inscripto en este curso." };
		}

		const payments = getPayments();
		if (!payments) return { ok: false, message: NOT_CONFIGURED };

		const returnUrl = `${context.origin}/cursos/${course.slug}/compra`;
		const result = await startCheckout(payments, {
			organizationId: tenant.id,
			course: {
				id: course.id,
				name: course.name,
				amount: price.amount,
				currency: price.currency,
			},
			user: { id: user.id, email: user.email },
			returnUrl,
		});
		if (!result.ok) {
			return {
				ok: false,
				message: "Esta academia todavía no puede cobrar. Probá más tarde.",
			};
		}
		return {
			ok: true,
			paymentId: result.gatewayPaymentId,
			clientSecret: result.clientSecret,
			publishableKey: result.publishableKey,
			sdkUrl: payments.sdkUrl,
			backendUrl: payments.publicUrl,
			returnUrl,
		};
	});

export const enrollInFreeCourse = createServerFn({ method: "POST" })
	.validator((data: unknown) => courseInput.parse(data))
	.handler(async ({ data }): Promise<Result> => {
		const { user, tenant, roles } = await requireTenantContext();
		if (!user) return { ok: false, message: "Ingresá para inscribirte." };

		const course = await findPublishedCourse(tenant.id, data.courseSlug);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		if (priceOf(course))
			return { ok: false, message: "Este curso es de pago." };

		if (roles.length === 0) {
			await auth.api.addMember({
				body: { userId: user.id, role: "student", organizationId: tenant.id },
			});
		}
		await getCatalog().enroll({
			courseId: course.id,
			userId: user.id,
			source: "free",
		});
		return { ok: true };
	});

export type PurchaseStatus =
	| { kind: "unknown" }
	| { kind: "pending" | "failed"; courseSlug: string }
	| { kind: "succeeded"; courseSlug: string };

export const getPurchaseStatus = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z.object({ paymentId: z.string().min(1).max(100) }).parse(data),
	)
	.handler(async ({ data }): Promise<PurchaseStatus> => {
		const { user, tenant } = await requireTenantContext();
		const payments = getPayments();
		if (!user || !payments) return { kind: "unknown" };

		const payment = await payments.repository.findByGatewayId(data.paymentId);
		if (
			!payment ||
			payment.userId !== user.id ||
			payment.organizationId !== tenant.id
		) {
			return { kind: "unknown" };
		}
		const course = await getCatalog().findById(tenant.id, payment.courseId);
		if (!course) return { kind: "unknown" };

		let status = payment.status;
		if (status === "pending") {
			const merchant = await payments.repository.findMerchant(tenant.id);
			if (merchant) {
				const remote = await payments.gateway.retrievePayment(
					merchant,
					data.paymentId,
				);
				const applied = await applyGatewayStatus(
					payments,
					fulfillPayment,
					data.paymentId,
					remote.status,
				);
				if (applied !== "unknown-payment") status = applied;
			}
		}
		return { kind: status, courseSlug: course.slug };
	});
