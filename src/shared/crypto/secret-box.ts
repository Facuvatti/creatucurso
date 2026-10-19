import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function toKey(base64: string): Buffer {
	const key = Buffer.from(base64, "base64");
	if (key.length !== 32) {
		throw new Error("The encryption key must be 32 bytes encoded as base64.");
	}
	return key;
}

/** Encrypts a small secret (AES-256-GCM). The result is safe to store as text. */
export function encryptSecret(plain: string, keyBase64: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", toKey(keyBase64), iv);
	const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return [
		VERSION,
		iv.toString("base64"),
		cipher.getAuthTag().toString("base64"),
		data.toString("base64"),
	].join(":");
}

export function decryptSecret(box: string, keyBase64: string): string {
	const [version, iv, tag, data] = box.split(":");
	if (version !== VERSION || !iv || !tag || !data) {
		throw new Error("Unsupported secret format.");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		toKey(keyBase64),
		Buffer.from(iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(data, "base64")),
		decipher.final(),
	]).toString("utf8");
}
