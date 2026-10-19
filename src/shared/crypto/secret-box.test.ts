import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-box.ts";

const key = randomBytes(32).toString("base64");

describe("secret box", () => {
	it("gives back what was encrypted", () => {
		expect(decryptSecret(encryptSecret("sk_live_123", key), key)).toBe(
			"sk_live_123",
		);
	});

	it("never repeats the same output for the same text", () => {
		expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
	});

	it("does not contain the plain text", () => {
		expect(encryptSecret("sk_live_123", key)).not.toContain("sk_live_123");
	});

	it("refuses a different key or tampered data", () => {
		const box = encryptSecret("secret", key);
		const other = randomBytes(32).toString("base64");

		expect(() => decryptSecret(box, other)).toThrow();
		const [version, iv, tag, data = ""] = box.split(":");
		const changed = `${data.startsWith("A") ? "B" : "A"}${data.slice(1)}`;
		expect(() =>
			decryptSecret([version, iv, tag, changed].join(":"), key),
		).toThrow();
		expect(() => decryptSecret("plain", key)).toThrow();
	});

	it("requires a 32 byte key", () => {
		expect(() =>
			encryptSecret("x", Buffer.from("short").toString("base64")),
		).toThrow(/32 bytes/);
	});
});
