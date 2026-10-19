import type { TenantDirectory } from "../application/resolve-tenant.ts";
import type { Tenant } from "../domain/tenant.ts";

export type CacheOptions = {
	ttlMs: number;
	missTtlMs: number;
	maxEntries: number;
	now?: () => number;
};

type Entry = { value: Tenant | null; expiresAt: number };

export type CachedTenantDirectory = TenantDirectory & { clear(): void };

export function createCachedTenantDirectory(
	inner: TenantDirectory,
	{ ttlMs, missTtlMs, maxEntries, now = Date.now }: CacheOptions,
): CachedTenantDirectory {
	const entries = new Map<string, Entry>();
	const inFlight = new Map<string, Promise<Tenant | null>>();

	async function lookup(
		key: string,
		load: () => Promise<Tenant | null>,
	): Promise<Tenant | null> {
		const cached = entries.get(key);
		if (cached && cached.expiresAt > now()) {
			entries.delete(key);
			entries.set(key, cached);
			return cached.value;
		}

		const pending = inFlight.get(key);
		if (pending) return pending;

		const request = load()
			.then((value) => {
				entries.delete(key);
				entries.set(key, {
					value,
					expiresAt: now() + (value ? ttlMs : missTtlMs),
				});
				while (entries.size > maxEntries) {
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

	return {
		findBySlug: (slug) => lookup(`slug:${slug}`, () => inner.findBySlug(slug)),
		findByVerifiedCustomDomain: (domain) =>
			lookup(`domain:${domain}`, () =>
				inner.findByVerifiedCustomDomain(domain),
			),
		clear: () => {
			entries.clear();
			inFlight.clear();
		},
	};
}
