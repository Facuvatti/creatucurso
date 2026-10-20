import { pool } from "../../server/db.server.ts";
import { classifyHost, RESERVED_SUBDOMAINS } from "./classify-host.ts";

export type Tenant = {
	id: string;
	slug: string;
	name: string;
};

export type HostResolution =
	| { kind: "landing" }
	| { kind: "platform-app" }
	| { kind: "tenant"; tenant: Tenant }
	| { kind: "unknown" };

export type ReturnTarget = { origin: string; path: string };

const SLUG = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$/;

/** Returns an error message, or null when the slug can be used as a subdomain. */
export function validateTenantSlug(slug: string): string | null {
	if (!SLUG.test(slug)) {
		return "Usá entre 3 y 63 letras minúsculas, números o guiones, sin empezar ni terminar con guion.";
	}
	if (RESERVED_SUBDOMAINS.has(slug)) {
		return "Ese nombre está reservado.";
	}
	return null;
}

// ------------------------------------------------------------ cached lookups

const TTL_MS = 60_000;
const MISS_TTL_MS = 5_000;
const MAX_ENTRIES = 1_000;

type Entry = { value: Tenant | null; expiresAt: number };

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Tenant | null>>();

async function cached(
	key: string,
	load: () => Promise<Tenant | null>,
): Promise<Tenant | null> {
	const hit = entries.get(key);
	if (hit && hit.expiresAt > Date.now()) {
		entries.delete(key);
		entries.set(key, hit);
		return hit.value;
	}

	const pending = inFlight.get(key);
	if (pending) return pending;

	const request = load()
		.then((value) => {
			entries.delete(key);
			entries.set(key, {
				value,
				expiresAt: Date.now() + (value ? TTL_MS : MISS_TTL_MS),
			});
			while (entries.size > MAX_ENTRIES) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
			return value;
		})
		.finally(() => inFlight.delete(key));

	inFlight.set(key, request);
	return request;
}

async function findOne(
	condition: string,
	value: string,
): Promise<Tenant | null> {
	const { rows } = await pool.query<Tenant>(
		`select id, slug, name from auth.organization where ${condition} limit 1`,
		[value],
	);
	return rows[0] ?? null;
}

function findBySlug(slug: string) {
	return cached(`slug:${slug}`, () => findOne("slug = $1", slug));
}

function findByVerifiedCustomDomain(domain: string) {
	return cached(`domain:${domain}`, () =>
		findOne(
			`"customDomain" = $1 and "customDomainVerifiedAt" is not null`,
			domain,
		),
	);
}

// ---------------------------------------------------------------- resolution

/** Works out which site a request Host belongs to. */
export async function resolveTenant(host: string): Promise<HostResolution> {
	const platformDomain = process.env.PLATFORM_DOMAIN ?? "localhost";
	const classification = classifyHost(host, { platformDomain });

	switch (classification.kind) {
		case "landing":
		case "platform-app":
		case "unknown":
			return { kind: classification.kind };
		case "subdomain": {
			const tenant = await findBySlug(classification.slug);
			return tenant ? { kind: "tenant", tenant } : { kind: "unknown" };
		}
		case "custom-domain": {
			const tenant = await findByVerifiedCustomDomain(classification.domain);
			return tenant ? { kind: "tenant", tenant } : { kind: "unknown" };
		}
	}
}

/**
 * Validates the address a visitor wants to come back to after logging in.
 * Only a known creator site is accepted, so the login can never redirect
 * to an arbitrary address.
 */
export async function resolveReturnTarget(
	returnUrl: string,
): Promise<ReturnTarget | null> {
	let url: URL;
	try {
		url = new URL(returnUrl);
	} catch {
		return null;
	}

	const protocol = `${process.env.PUBLIC_URL_SCHEME ?? "https"}:`;
	if (url.protocol !== protocol || url.username || url.password) return null;

	const resolution = await resolveTenant(url.host);
	if (resolution.kind !== "tenant") return null;

	return { origin: url.origin, path: `${url.pathname}${url.search}` };
}
