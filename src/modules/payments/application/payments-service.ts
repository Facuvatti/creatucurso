import {
	isValidSignature,
	mapGatewayStatus,
	type PaymentStatus,
} from "../domain/payment.ts";
import type {
	FulfillPayment,
	MerchantCredentials,
	PaymentGateway,
	PaymentRepository,
} from "./ports.ts";

type Deps = {
	gateway: PaymentGateway;
	repository: PaymentRepository;
};

export async function activatePayments(
	{ gateway, repository }: Deps,
	input: { organizationId: string; name: string; webhookUrl: string },
): Promise<MerchantCredentials> {
	const existing = await repository.findMerchant(input.organizationId);
	if (existing) return existing;

	const created = await gateway.createMerchant(input);
	const merchant = { organizationId: input.organizationId, ...created };
	await repository.saveMerchant(merchant);
	return merchant;
}

export type CheckoutInput = {
	organizationId: string;
	course: { id: string; name: string; amount: number; currency: string };
	user: { id: string; email: string };
	returnUrl: string;
};

export type CheckoutResult =
	| {
			ok: true;
			gatewayPaymentId: string;
			clientSecret: string;
			publishableKey: string;
	  }
	| { ok: false; reason: "payments-not-active" };

export async function startCheckout(
	{ gateway, repository }: Deps,
	input: CheckoutInput,
): Promise<CheckoutResult> {
	const merchant = await repository.findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "payments-not-active" };

	const created = await gateway.createPayment(merchant, {
		amount: input.course.amount,
		currency: input.course.currency,
		description: input.course.name,
		returnUrl: input.returnUrl,
		customerId: input.user.id,
		metadata: { courseId: input.course.id, userId: input.user.id },
	});

	await repository.createPayment({
		organizationId: input.organizationId,
		courseId: input.course.id,
		userId: input.user.id,
		gatewayPaymentId: created.gatewayPaymentId,
		amount: input.course.amount,
		currency: input.course.currency,
	});

	return {
		ok: true,
		gatewayPaymentId: created.gatewayPaymentId,
		clientSecret: created.clientSecret,
		publishableKey: merchant.publishableKey,
	};
}

/**
 * Records what the gateway says about a payment. When it succeeded, the
 * student is enrolled first and the payment is marked afterwards, so a failure
 * in between is retried by the next webhook instead of being lost.
 */
export async function applyGatewayStatus(
	{ repository }: Pick<Deps, "repository">,
	fulfill: FulfillPayment,
	gatewayPaymentId: string,
	gatewayStatus: string,
): Promise<PaymentStatus | "unknown-payment"> {
	const payment = await repository.findByGatewayId(gatewayPaymentId);
	if (!payment) return "unknown-payment";

	const status = mapGatewayStatus(gatewayStatus);
	if (status === "succeeded") {
		await fulfill(payment);
	}
	if (status !== payment.status) {
		await repository.setStatus(gatewayPaymentId, status);
	}
	return status;
}

export type WebhookOutcome =
	| { ok: true }
	| { ok: false; reason: "no-merchant" | "bad-signature" | "bad-payload" };

/** Verifies and applies a webhook sent by the gateway for one academy. */
export async function handleWebhook(
	deps: Pick<Deps, "repository">,
	fulfill: FulfillPayment,
	input: { organizationId: string; rawBody: string; signature: string | null },
): Promise<WebhookOutcome> {
	const merchant = await deps.repository.findMerchant(input.organizationId);
	if (!merchant) return { ok: false, reason: "no-merchant" };
	if (
		!isValidSignature(input.rawBody, merchant.webhookSecret, input.signature)
	) {
		return { ok: false, reason: "bad-signature" };
	}

	const event = parseEvent(input.rawBody);
	if (!event) return { ok: false, reason: "bad-payload" };

	if (event.gatewayPaymentId && event.status) {
		await applyGatewayStatus(
			deps,
			fulfill,
			event.gatewayPaymentId,
			event.status,
		);
	}
	return { ok: true };
}

function parseEvent(
	rawBody: string,
): { gatewayPaymentId: string | null; status: string | null } | null {
	try {
		const body = JSON.parse(rawBody) as {
			content?: { object?: { payment_id?: unknown; status?: unknown } };
		};
		const object = body.content?.object;
		return {
			gatewayPaymentId:
				typeof object?.payment_id === "string" ? object.payment_id : null,
			status: typeof object?.status === "string" ? object.status : null,
		};
	} catch {
		return null;
	}
}
