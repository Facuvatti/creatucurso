import { RESERVED_SUBDOMAINS } from "./classify-host.ts";

const SLUG = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$/;

/** Returns an error message, or null when the slug can be used as a subdomain. */
export function validateTenantSlug(slug: string): string | null {
	if (!SLUG.test(slug)) {
		return "Usá entre 3 y 63 letras minúsculas, números o guiones, sin empezar ni terminar con guion.";
	}
	if (slug === "www" || slug === "app" || RESERVED_SUBDOMAINS.has(slug)) {
		return "Ese nombre está reservado.";
	}
	return null;
}
