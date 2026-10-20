// Tiny checks for the trust boundaries (server function inputs). Each one
// throws an Error with a clear message; everything else relies on the database.

export function record(data: unknown): Record<string, unknown> {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error("The request must be an object.");
	}
	return data as Record<string, unknown>;
}

/** A trimmed string between `min` and `max` characters. */
export function text(
	input: Record<string, unknown>,
	key: string,
	max: number,
	min = 0,
): string {
	const value = input[key];
	if (typeof value !== "string") throw new Error(`${key} must be text.`);
	const trimmed = value.trim();
	if (trimmed.length < min || trimmed.length > max) {
		throw new Error(`${key} must have between ${min} and ${max} characters.`);
	}
	return trimmed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string" || !UUID.test(value)) {
		throw new Error(`${key} must be an id.`);
	}
	return value;
}

export function email(input: Record<string, unknown>, key: string): string {
	const value = text(input, key, 320, 3);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
		throw new Error(`${key} must be an email address.`);
	}
	return value;
}

export function bool(input: Record<string, unknown>, key: string): boolean {
	const value = input[key];
	if (typeof value !== "boolean")
		throw new Error(`${key} must be true or false.`);
	return value;
}

export function oneOf<T extends string>(
	input: Record<string, unknown>,
	key: string,
	allowed: readonly T[],
): T {
	const value = input[key];
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
	}
	return value as T;
}
