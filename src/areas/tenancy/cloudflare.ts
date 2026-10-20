// Cloudflare for SaaS "Custom Hostnames" (ADR-0024). Plain fetch calls; the token
// and response bodies are never logged. Errors carry only the HTTP status and
// Cloudflare's numeric error codes.

export class CloudflareError extends Error {
	status: number;
	codes: number[];

	constructor(status: number, codes: number[]) {
		super(`Cloudflare API error: HTTP ${status}, codes [${codes.join(",")}]`);
		this.name = "CloudflareError";
		this.status = status;
		this.codes = codes;
	}
}

export type CustomHostname = {
	id: string;
	/** Hostname status: pending, active, blocked, ... */
	status: string;
	/** Certificate status: pending_validation, pending_issuance, active, ... */
	sslStatus: string;
	verificationErrors: string[];
};

/** Custom domains need the API token and the platform zone. */
export function cloudflareEnabled(): boolean {
	return Boolean(
		process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID,
	);
}

type Raw = {
	id?: string;
	status?: string;
	ssl?: { status?: string };
	verification_errors?: unknown;
};

function toHostname(raw: Raw): CustomHostname {
	return {
		id: String(raw.id),
		status: String(raw.status ?? "pending"),
		sslStatus: String(raw.ssl?.status ?? "initializing"),
		verificationErrors: Array.isArray(raw.verification_errors)
			? raw.verification_errors.map(String)
			: [],
	};
}

async function call(
	method: "GET" | "POST" | "DELETE",
	path: string,
	body?: object,
): Promise<unknown> {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	const zone = process.env.CLOUDFLARE_ZONE_ID;
	if (!token || !zone) throw new Error("Cloudflare is not configured");
	const base =
		process.env.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";

	const response = await fetch(
		`${base}/zones/${zone}/custom_hostnames${path}`,
		{
			method,
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(15_000),
		},
	);
	const json = (await response.json().catch(() => null)) as {
		success?: boolean;
		errors?: { code?: number }[];
		result?: unknown;
	} | null;
	if (!response.ok || !json?.success) {
		const codes = (json?.errors ?? []).map((e) => Number(e.code));
		throw new CloudflareError(response.status, codes);
	}
	return json.result;
}

export async function createHostname(
	hostname: string,
): Promise<CustomHostname> {
	const result = await call("POST", "", {
		hostname,
		ssl: {
			method: "http",
			type: "dv",
			settings: { min_tls_version: "1.2" },
		},
	});
	return toHostname(result as Raw);
}

export async function getHostname(id: string): Promise<CustomHostname | null> {
	try {
		return toHostname((await call("GET", `/${id}`)) as Raw);
	} catch (error) {
		if (error instanceof CloudflareError && error.status === 404) return null;
		throw error;
	}
}

export async function findHostname(
	hostname: string,
): Promise<CustomHostname | null> {
	const result = (await call(
		"GET",
		`?hostname=${encodeURIComponent(hostname)}`,
	)) as Raw[];
	return result[0] ? toHostname(result[0]) : null;
}

/** Deleting a hostname that is already gone counts as done. */
export async function deleteHostname(id: string): Promise<void> {
	try {
		await call("DELETE", `/${id}`);
	} catch (error) {
		if (error instanceof CloudflareError && error.status === 404) return;
		throw error;
	}
}
