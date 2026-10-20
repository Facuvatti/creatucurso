import { createServerFn } from "@tanstack/react-start";
import * as catalog from "../areas/catalog/catalog.ts";
import { can } from "../areas/identity/permissions.ts";
import { addConnector } from "../areas/payments/hyperswitch.ts";
import { type Provider, priceOf } from "../areas/payments/payment.ts";
import {
	activatePayments,
	connectMercadoPago,
	findMerchant,
	findPaymentByAnyId,
	findPaymentById,
	mercadoPagoAvailable,
	mercadoPagoWebhookUrl,
	paymentsConfig,
	refreshPayment,
	refundPayment,
	startCheckout,
} from "../areas/payments/payments.ts";
import {
	findSelfRefundablePayment,
	listPanelPayments,
	type PanelPayment,
	type PanelRefund,
} from "../areas/payments/refunds.ts";
import { oneOf, record, text, uuid } from "../shared/validate.ts";
import { auth } from "./auth.server.ts";
import { fulfillPayment } from "./fulfillment.server.ts";
import { requireStaffContext, requireTenantContext } from "./request.server.ts";

type Result = { ok: true } | { ok: false; message: string };

const NOT_CONFIGURED =
	"Los cobros no están configurados en esta instalación todavía.";

// ---------------------------------------------------------------- creator side

export type PaymentsPanel = {
	/** Hyperswitch is configured in this installation. */
	available: boolean;
	mercadoPagoAvailable: boolean;
	/** The provider the academy sells with, or null when none is set up. */
	provider: Provider | null;
	active: boolean;
	testConnectors: boolean;
	/** Where the creator points Mercado Pago's notifications. */
	mercadoPagoWebhookUrl: string;
	payments: PanelPayment[];
	refunds: PanelRefund[];
};

export const getPaymentsPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<PaymentsPanel> => {
		const { tenant } = await requireStaffContext();
		const merchant = await findMerchant(tenant.id);
		return {
			available: paymentsConfig() !== null,
			mercadoPagoAvailable: mercadoPagoAvailable(),
			provider: merchant?.provider ?? null,
			active: merchant !== null,
			testConnectors: process.env.NODE_ENV !== "production",
			mercadoPagoWebhookUrl: mercadoPagoWebhookUrl(tenant.id),
			...(await listPanelPayments(tenant.id)),
		};
	},
);

export const activateAcademyPayments = createServerFn({
	method: "POST",
}).handler(async (): Promise<Result> => {
	const { tenant } = await requireStaffContext();
	const payments = paymentsConfig();
	if (!payments) return { ok: false, message: NOT_CONFIGURED };

	await activatePayments(payments, {
		organizationId: tenant.id,
		name: tenant.name,
		webhookUrl: `${payments.webhookBaseUrl}/api/webhooks/hyperswitch/${tenant.id}`,
	});
	return { ok: true };
});

export const connectPaymentProvider = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const connectorName = text(input, "connectorName", 40, 2);
		if (!/^[a-z0-9_]{2,40}$/.test(connectorName)) {
			throw new Error("connectorName has an invalid format.");
		}
		return { connectorName, apiKey: text(input, "apiKey", 500, 8) };
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const payments = paymentsConfig();
		if (!payments) return { ok: false, message: NOT_CONFIGURED };

		const merchant = await findMerchant(tenant.id);
		if (!merchant || merchant.provider !== "hyperswitch") {
			return {
				ok: false,
				message: "Primero activá los cobros de tu academia.",
			};
		}
		try {
			await addConnector(payments, merchant, data);
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

export const connectMercadoPagoAccount = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			accessToken: text(input, "accessToken", 500, 20),
			webhookSecret: text(input, "webhookSecret", 500, 8),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		if (!mercadoPagoAvailable()) return { ok: false, message: NOT_CONFIGURED };
		try {
			await connectMercadoPago({ organizationId: tenant.id, ...data });
			return { ok: true };
		} catch (error) {
			console.error("Connecting Mercado Pago failed", error);
			return {
				ok: false,
				message:
					"Mercado Pago rechazó ese access token. Revisalo e intentá de nuevo.",
			};
		}
	});

/** Owner or admin refunds a payment, in full or in part (amount in major units). */
export const refundAcademyPayment = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const amount = input.amount;
		if (
			amount !== null &&
			(typeof amount !== "number" ||
				!Number.isFinite(amount) ||
				amount <= 0 ||
				amount > 10_000_000)
		) {
			throw new Error(
				"amount must be a positive number, or null for a full refund.",
			);
		}
		return { paymentId: uuid(input, "paymentId"), amount };
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant, roles } = await requireStaffContext();
		if (!can(roles, { billing: ["manage"] })) {
			return { ok: false, message: "No tenés permiso para hacer esto." };
		}
		const payment = await findPaymentById(data.paymentId);
		if (!payment || payment.organizationId !== tenant.id) {
			return { ok: false, message: "No encontramos el pago." };
		}
		return refundPayment(paymentsConfig(), payment, {
			requestedBy: "tenant",
			...(data.amount === null
				? {}
				: { amount: Math.round(data.amount * 100) }),
		});
	});

const CURRENCIES = [
	"ARS",
	"USD",
	"EUR",
	"BRL",
	"MXN",
	"CLP",
	"COP",
	"UYU",
] as const;

export const setCoursePrice = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		const price = input.price;
		if (
			price !== null &&
			(typeof price !== "number" ||
				!Number.isFinite(price) ||
				price < 0 ||
				price > 10_000_000)
		) {
			throw new Error("price must be a number from 0 to 10000000, or null.");
		}
		return {
			courseId: uuid(input, "courseId"),
			price,
			currency: oneOf(input, "currency", CURRENCIES),
		};
	})
	.handler(async ({ data }): Promise<Result> => {
		const { tenant } = await requireStaffContext();
		const amount = data.price === null ? 0 : Math.round(data.price * 100);
		const saved = await catalog.setCoursePrice(
			tenant.id,
			data.courseId,
			amount > 0 ? { amount, currency: data.currency } : null,
		);
		return saved
			? { ok: true }
			: { ok: false, message: "No encontramos el curso." };
	});

// ---------------------------------------------------------------- student side

function checkCourse(data: unknown) {
	return { courseSlug: text(record(data), "courseSlug", 200, 1) };
}

async function findPublishedCourse(organizationId: string, slug: string) {
	const lookup = await catalog.findCourseBySlug(organizationId, slug);
	return lookup?.kind === "found" && lookup.course.status === "published"
		? lookup.course
		: null;
}

export type CheckoutSession =
	| {
			ok: true;
			provider: "hyperswitch";
			paymentId: string;
			clientSecret: string;
			publishableKey: string;
			sdkUrl: string;
			backendUrl: string;
			returnUrl: string;
	  }
	| { ok: true; provider: "mercadopago"; redirectUrl: string }
	| { ok: false; message: string };

export const startCourseCheckout = createServerFn({ method: "POST" })
	.validator(checkCourse)
	.handler(async ({ data }): Promise<CheckoutSession> => {
		const context = await requireTenantContext();
		const { user, tenant } = context;
		if (!user)
			return { ok: false, message: "Ingresá para comprar este curso." };

		const course = await findPublishedCourse(tenant.id, data.courseSlug);
		if (!course) return { ok: false, message: "No encontramos el curso." };
		const price = priceOf(course);
		if (!price) return { ok: false, message: "Este curso es gratuito." };
		const enrollment = await catalog.findEnrollmentStatus(course.id, user.id);
		if (enrollment === "active") {
			return { ok: false, message: "Ya estás inscripto en este curso." };
		}
		if (enrollment === "suspended" || enrollment === "revoked") {
			return {
				ok: false,
				message:
					"Tu acceso a este curso está bloqueado. Contactá a la academia.",
			};
		}

		const payments = paymentsConfig();
		const returnUrl = `${context.origin}/cursos/${course.slug}/compra`;
		let result: Awaited<ReturnType<typeof startCheckout>>;
		try {
			result = await startCheckout(payments, {
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
		} catch (error) {
			console.error("Starting the checkout failed", error);
			return {
				ok: false,
				message: "No pudimos iniciar el pago. Probá de nuevo más tarde.",
			};
		}
		if (!result.ok) {
			return {
				ok: false,
				message: "Esta academia todavía no puede cobrar. Probá más tarde.",
			};
		}
		if (result.provider === "mercadopago") {
			return {
				ok: true,
				provider: "mercadopago",
				redirectUrl: result.redirectUrl,
			};
		}
		if (!payments) return { ok: false, message: NOT_CONFIGURED };
		return {
			ok: true,
			provider: "hyperswitch",
			paymentId: result.gatewayPaymentId,
			clientSecret: result.clientSecret,
			publishableKey: result.publishableKey,
			sdkUrl: payments.sdkUrl,
			backendUrl: payments.publicUrl,
			returnUrl,
		};
	});

export const enrollInFreeCourse = createServerFn({ method: "POST" })
	.validator(checkCourse)
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
		await catalog.enroll({
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
	.validator((data: unknown) => ({
		paymentId: text(record(data), "paymentId", 100, 1),
	}))
	.handler(async ({ data }): Promise<PurchaseStatus> => {
		const { user, tenant } = await requireTenantContext();
		if (!user) return { kind: "unknown" };

		const payment = await findPaymentByAnyId(data.paymentId);
		if (
			!payment ||
			payment.userId !== user.id ||
			payment.organizationId !== tenant.id
		) {
			return { kind: "unknown" };
		}
		const course = await catalog.findCourseById(tenant.id, payment.courseId);
		if (!course) return { kind: "unknown" };

		let status = payment.status;
		if (status === "pending") {
			try {
				status = await refreshPayment(
					fulfillPayment,
					paymentsConfig(),
					payment,
				);
			} catch (error) {
				console.error("Checking the payment failed", error);
			}
		}
		if (status === "refunded") return { kind: "unknown" };
		return { kind: status, courseSlug: course.slug };
	});

// --------------------------------------------------------- student self-service

/** True when the signed-in student may refund this course by themselves. */
export const getRefundEligibility = createServerFn({ method: "GET" })
	.validator(checkCourse)
	.handler(async ({ data }): Promise<boolean> => {
		const { user, tenant } = await requireTenantContext();
		if (!user) return false;
		const lookup = await catalog.findCourseBySlug(tenant.id, data.courseSlug);
		if (lookup?.kind !== "found") return false;
		return (
			(await findSelfRefundablePayment(lookup.course.id, user.id)) !== null
		);
	});

export const requestRefund = createServerFn({ method: "POST" })
	.validator(checkCourse)
	.handler(async ({ data }): Promise<Result> => {
		const { user, tenant } = await requireTenantContext();
		if (!user) return { ok: false, message: "Ingresá para continuar." };
		const lookup = await catalog.findCourseBySlug(tenant.id, data.courseSlug);
		if (lookup?.kind !== "found") {
			return { ok: false, message: "No encontramos el curso." };
		}
		// Eligibility is decided here, on the server, every time.
		const payment = await findSelfRefundablePayment(lookup.course.id, user.id);
		if (!payment || payment.organizationId !== tenant.id) {
			return {
				ok: false,
				message:
					"Ya no podés pedir el reembolso: pasaron más de 10 días o avanzaste más del 10% del curso.",
			};
		}
		return refundPayment(paymentsConfig(), payment, { requestedBy: "student" });
	});
