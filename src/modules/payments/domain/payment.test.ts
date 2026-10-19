import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSignature, mapGatewayStatus, priceOf } from "./payment.ts";

const sign = (body: string, secret: string) =>
	createHmac("sha512", secret).update(body).digest("hex");

describe("mapGatewayStatus", () => {
	it("maps the final states", () => {
		expect(mapGatewayStatus("succeeded")).toBe("succeeded");
		expect(mapGatewayStatus("failed")).toBe("failed");
		expect(mapGatewayStatus("cancelled")).toBe("failed");
	});

	it("keeps everything in progress as pending", () => {
		for (const status of [
			"processing",
			"requires_payment_method",
			"requires_customer_action",
			"requires_confirmation",
			"something_new",
		]) {
			expect(mapGatewayStatus(status)).toBe("pending");
		}
	});
});

describe("isValidSignature", () => {
	const body = '{"event_type":"payment_succeeded"}';

	it("accepts the right signature", () => {
		expect(isValidSignature(body, "secret", sign(body, "secret"))).toBe(true);
		expect(
			isValidSignature(body, "secret", sign(body, "secret").toUpperCase()),
		).toBe(true);
	});

	it("rejects a wrong secret, a changed body or a missing signature", () => {
		expect(isValidSignature(body, "secret", sign(body, "other"))).toBe(false);
		expect(isValidSignature(`${body} `, "secret", sign(body, "secret"))).toBe(
			false,
		);
		expect(isValidSignature(body, "secret", null)).toBe(false);
		expect(isValidSignature(body, "secret", "")).toBe(false);
		expect(isValidSignature(body, "secret", "abc")).toBe(false);
	});
});

describe("priceOf", () => {
	it("returns the price of a paid course", () => {
		expect(priceOf({ priceAmount: 4999, currency: "ARS" })).toEqual({
			amount: 4999,
			currency: "ARS",
		});
	});

	it("treats missing or zero prices as free", () => {
		expect(priceOf({ priceAmount: null, currency: null })).toBeNull();
		expect(priceOf({ priceAmount: 0, currency: "ARS" })).toBeNull();
		expect(priceOf({ priceAmount: 100, currency: null })).toBeNull();
	});
});
