import { describe, expect, it } from "vitest";
import { formatMoney } from "./money.ts";

describe("formatMoney", () => {
	it("shows minor units as a price with the currency", () => {
		const text = formatMoney(499900, "ARS").replace(/\s/g, " ");

		expect(text).toContain("4.999,00");
		expect(text).toContain("$");
	});

	it("keeps cents", () => {
		expect(formatMoney(1050, "USD")).toContain("10,50");
	});
});
