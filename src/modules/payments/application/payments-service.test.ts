import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaymentStatus } from "../domain/payment.ts";
import {
	activatePayments,
	applyGatewayStatus,
	handleWebhook,
	startCheckout,
} from "./payments-service.ts";
import type {
	FulfillPayment,
	MerchantCredentials,
	PaymentGateway,
	PaymentRecord,
	PaymentRepository,
} from "./ports.ts";

const merchant: MerchantCredentials = {
	organizationId: "org_1",
	gatewayMerchantId: "cc_org_1",
	gatewayProfileId: "pro_1",
	publishableKey: "pk_1",
	apiKey: "sk_1",
	webhookSecret: "whsec",
};

function setup(options: { withMerchant?: boolean } = {}) {
	const merchants = new Map<string, MerchantCredentials>();
	if (options.withMerchant !== false) merchants.set("org_1", merchant);
	const payments = new Map<string, PaymentRecord>();
	const calls: string[] = [];

	const repository: PaymentRepository = {
		async findMerchant(id) {
			return merchants.get(id) ?? null;
		},
		async saveMerchant(m) {
			merchants.set(m.organizationId, m);
		},
		async createPayment(p) {
			payments.set(p.gatewayPaymentId, {
				...p,
				id: `id_${payments.size}`,
				status: "pending",
			});
		},
		async findByGatewayId(id) {
			return payments.get(id) ?? null;
		},
		async setStatus(id, status: PaymentStatus) {
			const p = payments.get(id);
			if (p) payments.set(id, { ...p, status });
		},
	};

	const gateway: PaymentGateway = {
		async createMerchant() {
			calls.push("createMerchant");
			const { organizationId: _ignored, ...rest } = merchant;
			return rest;
		},
		async addConnector() {},
		async createPayment() {
			calls.push("createPayment");
			return { gatewayPaymentId: "pay_1", clientSecret: "secret_1" };
		},
		async retrievePayment() {
			return { status: "succeeded" };
		},
	};

	const fulfilled: string[] = [];
	const fulfill: FulfillPayment = async (p) => {
		fulfilled.push(p.gatewayPaymentId);
	};

	return { deps: { gateway, repository }, payments, calls, fulfill, fulfilled };
}

const checkoutInput = {
	organizationId: "org_1",
	course: { id: "course_1", name: "Python", amount: 5000, currency: "ARS" },
	user: { id: "user_1", email: "ana@example.com" },
	returnUrl: "https://maria.example.com/cursos/python/compra",
};

describe("activatePayments", () => {
	it("creates the gateway account once", async () => {
		const { deps, calls } = setup({ withMerchant: false });
		const input = {
			organizationId: "org_1",
			name: "Maria",
			webhookUrl: "https://x/hook",
		};

		await activatePayments(deps, input);
		await activatePayments(deps, input);

		expect(calls).toEqual(["createMerchant"]);
	});
});

describe("startCheckout", () => {
	it("creates the payment at the gateway and records it as pending", async () => {
		const { deps, payments } = setup();

		const result = await startCheckout(deps, checkoutInput);

		expect(result).toEqual({
			ok: true,
			gatewayPaymentId: "pay_1",
			clientSecret: "secret_1",
			publishableKey: "pk_1",
		});
		expect(payments.get("pay_1")).toMatchObject({
			userId: "user_1",
			courseId: "course_1",
			amount: 5000,
			status: "pending",
		});
	});

	it("refuses when the academy has not activated payments", async () => {
		const { deps, calls } = setup({ withMerchant: false });

		expect(await startCheckout(deps, checkoutInput)).toEqual({
			ok: false,
			reason: "payments-not-active",
		});
		expect(calls).not.toContain("createPayment");
	});
});

describe("applyGatewayStatus", () => {
	it("enrols the student and marks the payment when it succeeded", async () => {
		const { deps, payments, fulfill, fulfilled } = setup();
		await startCheckout(deps, checkoutInput);

		const status = await applyGatewayStatus(
			deps,
			fulfill,
			"pay_1",
			"succeeded",
		);

		expect(status).toBe("succeeded");
		expect(fulfilled).toEqual(["pay_1"]);
		expect(payments.get("pay_1")?.status).toBe("succeeded");
	});

	it("does not enrol on failures or while still in progress", async () => {
		const { deps, payments, fulfill, fulfilled } = setup();
		await startCheckout(deps, checkoutInput);

		await applyGatewayStatus(deps, fulfill, "pay_1", "processing");
		expect(payments.get("pay_1")?.status).toBe("pending");
		await applyGatewayStatus(deps, fulfill, "pay_1", "failed");
		expect(payments.get("pay_1")?.status).toBe("failed");
		expect(fulfilled).toEqual([]);
	});

	it("keeps the payment pending when enrolling fails, so a retry can finish it", async () => {
		const { deps, payments } = setup();
		await startCheckout(deps, checkoutInput);
		const broken: FulfillPayment = async () => {
			throw new Error("database down");
		};

		await expect(
			applyGatewayStatus(deps, broken, "pay_1", "succeeded"),
		).rejects.toThrow("database down");

		expect(payments.get("pay_1")?.status).toBe("pending");
	});

	it("ignores payments it does not know", async () => {
		const { deps, fulfill } = setup();

		expect(await applyGatewayStatus(deps, fulfill, "ghost", "succeeded")).toBe(
			"unknown-payment",
		);
	});
});

describe("handleWebhook", () => {
	const body = JSON.stringify({
		event_type: "payment_succeeded",
		content: { object: { payment_id: "pay_1", status: "succeeded" } },
	});
	const sign = (text: string) =>
		createHmac("sha512", "whsec").update(text).digest("hex");

	it("applies a correctly signed event", async () => {
		const { deps, payments, fulfill, fulfilled } = setup();
		await startCheckout(deps, checkoutInput);

		const result = await handleWebhook(deps, fulfill, {
			organizationId: "org_1",
			rawBody: body,
			signature: sign(body),
		});

		expect(result).toEqual({ ok: true });
		expect(fulfilled).toEqual(["pay_1"]);
		expect(payments.get("pay_1")?.status).toBe("succeeded");
	});

	it("rejects a wrong signature without touching anything", async () => {
		const { deps, payments, fulfill, fulfilled } = setup();
		await startCheckout(deps, checkoutInput);

		const result = await handleWebhook(deps, fulfill, {
			organizationId: "org_1",
			rawBody: body,
			signature: sign("other"),
		});

		expect(result).toEqual({ ok: false, reason: "bad-signature" });
		expect(fulfilled).toEqual([]);
		expect(payments.get("pay_1")?.status).toBe("pending");
	});

	it("rejects unknown academies and unreadable bodies", async () => {
		const { deps, fulfill } = setup();

		expect(
			await handleWebhook(deps, fulfill, {
				organizationId: "ghost",
				rawBody: body,
				signature: sign(body),
			}),
		).toEqual({ ok: false, reason: "no-merchant" });
		expect(
			await handleWebhook(deps, fulfill, {
				organizationId: "org_1",
				rawBody: "not json",
				signature: sign("not json"),
			}),
		).toEqual({ ok: false, reason: "bad-payload" });
	});

	it("is safe to deliver twice", async () => {
		const { deps, fulfill, fulfilled } = setup();
		await startCheckout(deps, checkoutInput);
		const input = {
			organizationId: "org_1",
			rawBody: body,
			signature: sign(body),
		};

		await handleWebhook(deps, fulfill, input);
		await handleWebhook(deps, fulfill, input);

		expect(fulfilled.every((id) => id === "pay_1")).toBe(true);
	});
});
