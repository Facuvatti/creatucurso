// Address check of an embedded app. Pure (no database), so the course importer can use it.
import { classifyHost, normalize } from "../tenancy/classify-host.ts";

const MAX_URL_LENGTH = 2048;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type EmbedUrlResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

/**
 * Checks the address of an embedded app: https only, no credentials, standard
 * port, a real domain name (no IP, no localhost) outside the platform domain.
 * `EMBED_ALLOW_LOCAL=true` (dev only) also accepts http://localhost and 127.0.0.1.
 */
export function validateEmbedUrl(input: string): EmbedUrlResult {
	const raw = input.trim();
	if (raw === "") return { ok: false, message: "must not be empty" };
	if (raw.length > MAX_URL_LENGTH) {
		return {
			ok: false,
			message: `must have at most ${MAX_URL_LENGTH} characters`,
		};
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, message: "must be a valid URL" };
	}

	const host = normalize(url.hostname);
	if (
		process.env.EMBED_ALLOW_LOCAL === "true" &&
		LOCAL_HOSTS.has(host) &&
		(url.protocol === "http:" || url.protocol === "https:")
	) {
		if (url.username || url.password) {
			return { ok: false, message: "must not contain credentials" };
		}
		return { ok: true, url: url.href };
	}

	if (url.protocol !== "https:")
		return { ok: false, message: "must start with https://" };
	if (url.username || url.password) {
		return { ok: false, message: "must not contain credentials" };
	}
	if (url.port !== "")
		return { ok: false, message: "must use the default port" };
	if (host.startsWith("[") || /^[\d.]+$/.test(host)) {
		return { ok: false, message: "must use a domain name, not an IP address" };
	}
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		!host.includes(".")
	) {
		return { ok: false, message: "must use a public domain name" };
	}

	const platformDomain = (
		process.env.PLATFORM_DOMAIN ?? "localhost"
	).toLowerCase();
	const kind = classifyHost(host, { platformDomain }).kind;
	if (
		host === platformDomain ||
		host.endsWith(`.${platformDomain}`) ||
		kind === "landing" ||
		kind === "platform-app" ||
		kind === "subdomain"
	) {
		return { ok: false, message: "must not point to the platform itself" };
	}
	return { ok: true, url: url.href };
}

/** The origin (scheme, host, port) of an embed URL, as a browser reports it in `event.origin`. */
export function embedOrigin(url: string): string {
	return new URL(url).origin;
}
