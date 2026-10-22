// Domain Connect, synchronous flow (ADR-0030). When the creator's DNS provider
// supports our template (infra/domain-connect/), the panel sends the owner to
// the provider's consent page instead of asking for a manual CNAME. The provider
// applies the record and sends the browser back to /api/domain-connect/return/<state>;
// from there the usual CNAME check (refreshDomain) takes over. Spec:
// https://github.com/Domain-Connect/spec (discovery, settings, apply, signing).
// The private key is never logged.
import {
	createHash,
	createHmac,
	createPrivateKey,
	type KeyObject,
	randomBytes,
	sign,
	timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { pool } from "../../server/db.server.ts";
import { appOrigin } from "../../server/origins.server.ts";
import { cloudflareEnabled } from "./cloudflare.ts";
import { getDomainState, refreshDomain } from "./domains.ts";
import { resolveTenant } from "./tenants.ts";

/** serviceId of our template; providerId is the platform domain. */
const SERVICE_ID = "customdomain";
const STATE_MINUTES = 30;
const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;

export function domainConnectEnabled(): boolean {
	return Boolean(
		cloudflareEnabled() &&
			process.env.DOMAIN_CONNECT_PRIVATE_KEY &&
			process.env.DOMAIN_CONNECT_KEY_ID &&
			process.env.SECRETS_ENCRYPTION_KEY,
	);
}

/** Must match `providerId` of the published template. */
function providerId(): string {
	return process.env.PLATFORM_DOMAIN ?? "localhost";
}

// ------------------------------------------------------------ safe HTTP GET

// Discovery URLs come from a TXT record anyone can publish, so requests only go
// to public addresses over https, never follow redirects and read a small body.
const privateRanges = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 3],
] as const) {
	privateRanges.addSubnet(network, prefix, "ipv4");
}
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked against the IPv4 rules.
for (const [network, prefix] of [
	["::", 127],
	["64:ff9b::", 96],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	privateRanges.addSubnet(network, prefix, "ipv6");
}

type LookupCallback = (
	error: Error | null,
	address: string | { address: string; family: number }[],
	family?: number,
) => void;

/** dns.lookup that refuses names resolving to a private address (checked at connect time). */
function publicLookup(
	hostname: string,
	options: { all?: boolean },
	callback: LookupCallback,
): void {
	lookup(hostname, { all: true }, (error, addresses) => {
		if (error) return callback(error, []);
		const blocked = addresses.some((a) =>
			privateRanges.check(a.address, a.family === 6 ? "ipv6" : "ipv4"),
		);
		const first = addresses[0];
		if (blocked || !first) {
			return callback(new Error("Address not allowed"), []);
		}
		if (options.all) return callback(null, addresses);
		callback(null, first.address, first.family);
	});
}

type Fetched = { status: number; body: string };

async function getUrl(url: string): Promise<Fetched> {
	// Manual tests only: a local mock provider over plain http (docs/domain-connect-setup.md).
	const override = process.env.DOMAIN_CONNECT_DISCOVERY_OVERRIDE;
	if (override && url.startsWith(override)) {
		const response = await fetch(url, {
			redirect: "manual",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		return {
			status: response.status,
			body: (await response.text()).slice(0, MAX_BODY_BYTES),
		};
	}

	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || isIP(parsed.hostname)) {
		throw new Error("Only https URLs with a host name are fetched");
	}
	return new Promise((resolve, reject) => {
		const req = request(
			parsed,
			{ method: "GET", lookup: publicLookup, timeout: FETCH_TIMEOUT_MS },
			(res) => {
				let size = 0;
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_BODY_BYTES) {
						req.destroy(new Error("Response too large"));
						return;
					}
					chunks.push(chunk);
				});
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
				res.on("error", reject);
			},
		);
		req.on("timeout", () => req.destroy(new Error("Timed out")));
		req.on("error", reject);
		req.end();
	});
}

/** An https URL prefix from the provider's settings (or the test override). */
function urlPrefix(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 300) return null;
	const override = process.env.DOMAIN_CONNECT_DISCOVERY_OVERRIDE;
	if (override && value.startsWith(override)) return value.replace(/\/+$/, "");
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.search && !url.hash
			? value.replace(/\/+$/, "")
			: null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- discovery

export type DomainConnectOffer = {
	/** Name of the DNS provider, shown on the button. */
	providerName: string;
	urlSyncUX: string;
	/** Zone (root domain) and host: cursos.maria.com -> maria.com + cursos. */
	zone: string;
	host: string;
};

const resolver = new Resolver({ timeout: 2000, tries: 2 });
const cache = new Map<
	string,
	{ at: number; offer: DomainConnectOffer | null }
>();

/**
 * The zone of a custom domain: the closest parent name with its own NS records.
 * The domain itself is skipped because our template needs a host (the CNAME
 * can not live at the zone apex).
 */
async function zoneOf(domain: string): Promise<string | null> {
	const labels = domain.split(".");
	if (process.env.DOMAIN_CONNECT_DISCOVERY_OVERRIDE) {
		return labels.slice(1).join(".");
	}
	for (let i = 1; i <= labels.length - 2; i++) {
		const candidate = labels.slice(i).join(".");
		try {
			if ((await resolver.resolveNs(candidate)).length > 0) return candidate;
		} catch {
			// No NS here: try the parent.
		}
	}
	return null;
}

/** https://<_domainconnect TXT value>, or the test override. */
async function discoveryPrefix(zone: string): Promise<string | null> {
	const override = process.env.DOMAIN_CONNECT_DISCOVERY_OVERRIDE;
	if (override) return override.replace(/\/+$/, "");
	let records: string[][];
	try {
		records = await resolver.resolveTxt(`_domainconnect.${zone}`);
	} catch {
		return null;
	}
	const value = records[0]?.join("").trim().replace(/\/+$/, "") ?? "";
	return /^[a-z0-9.-]+\.[a-z]{2,}(\/[\w.~/-]*)?$/i.test(value)
		? `https://${value}`
		: null;
}

async function discover(domain: string): Promise<DomainConnectOffer | null> {
	const zone = await zoneOf(domain);
	if (!zone || !domain.endsWith(`.${zone}`)) return null;
	const prefix = await discoveryPrefix(zone);
	if (!prefix) return null;

	const settings = await getUrl(`${prefix}/v2/${zone}/settings`);
	if (settings.status < 200 || settings.status > 299) return null;
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(settings.body) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (typeof json !== "object" || json === null) return null;
	const urlAPI = urlPrefix(json.urlAPI);
	// Without urlSyncUX the provider does not offer the synchronous flow.
	const urlSyncUX = urlPrefix(json.urlSyncUX);
	const rawName = [json.providerDisplayName, json.providerName].find(
		(name) => typeof name === "string" && name.trim(),
	) as string | undefined;
	if (!urlAPI || !urlSyncUX || !rawName) return null;

	const supported = await getUrl(
		`${urlAPI}/v2/domainTemplates/providers/${encodeURIComponent(providerId())}/services/${SERVICE_ID}`,
	);
	if (supported.status < 200 || supported.status > 299) return null;

	return {
		providerName: rawName.trim().slice(0, 60),
		urlSyncUX,
		zone,
		host: domain.slice(0, -(zone.length + 1)),
	};
}

/**
 * Whether the domain's DNS provider supports our template. Any failure means
 * "no" (manual CNAME). Answers are cached for a few minutes.
 */
export async function findDomainConnect(
	domain: string,
): Promise<DomainConnectOffer | null> {
	if (!domainConnectEnabled()) return null;
	const cached = cache.get(domain);
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.offer;
	let offer: DomainConnectOffer | null = null;
	try {
		offer = await discover(domain);
	} catch {
		offer = null;
	}
	if (cache.size > 1000) cache.clear();
	cache.set(domain, { at: Date.now(), offer });
	return offer;
}

// ---------------------------------------------------------------- state

function stateKey(): Buffer {
	const secret = process.env.SECRETS_ENCRYPTION_KEY;
	if (!secret) throw new Error("SECRETS_ENCRYPTION_KEY is required.");
	return createHmac("sha256", secret).update("domain-connect-state").digest();
}

/** "<nonce>.<signature>"; the signature covers what the single-use row stores. */
function signState(
	nonce: string,
	organizationId: string,
	domain: string,
	expiresAt: number,
): string {
	const signature = createHmac("sha256", stateKey())
		.update(`${nonce}|${organizationId}|${domain}|${expiresAt}`)
		.digest("base64url")
		.slice(0, 22);
	return `${nonce}.${signature}`;
}

const hashState = (state: string) =>
	createHash("sha256").update(state).digest("hex");

/** Where the owner returns to: a host of that same academy. */
async function isReturnOrigin(
	organizationId: string,
	origin: string,
): Promise<boolean> {
	try {
		const host = await resolveTenant(new URL(origin).host);
		return host.kind === "tenant" && host.tenant.id === organizationId;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------- apply

/** The private key: PEM text, or PEM encoded in base64 (one line in .env). */
function privateKey(): KeyObject {
	const raw = process.env.DOMAIN_CONNECT_PRIVATE_KEY ?? "";
	const pem = raw.includes("-----BEGIN")
		? raw.replace(/\\n/g, "\n")
		: Buffer.from(raw, "base64").toString("utf8");
	return createPrivateKey(pem);
}

/** Return address on the app host (inside syncRedirectDomain of the template). */
export function returnUrl(state: string): string {
	return `${appOrigin()}/api/domain-connect/return/${state}`;
}

/**
 * Creates the single-use state and returns the provider's signed apply URL.
 * The state also travels in the redirect path, because some providers
 * (Cloudflare) do not send `state` back.
 */
export async function startDomainConnect(input: {
	organizationId: string;
	userId: string;
	domain: string;
	returnOrigin: string;
	offer: DomainConnectOffer;
}): Promise<string> {
	const keyId = process.env.DOMAIN_CONNECT_KEY_ID;
	if (!keyId) throw new Error("DOMAIN_CONNECT_KEY_ID is required.");
	if (!(await isReturnOrigin(input.organizationId, input.returnOrigin))) {
		throw new Error("The return address does not belong to this academy.");
	}
	const expiresAt = Date.now() + STATE_MINUTES * 60 * 1000;
	const state = signState(
		randomBytes(16).toString("base64url"),
		input.organizationId,
		input.domain,
		expiresAt,
	);
	await pool.query(
		"delete from tenancy.domain_connect_state where expires_at < now()",
	);
	await pool.query(
		`insert into tenancy.domain_connect_state
		 (state_hash, organization_id, user_id, domain, return_origin, expires_at)
		 values ($1, $2, $3, $4, $5, $6)`,
		[
			hashState(state),
			input.organizationId,
			input.userId,
			input.domain,
			input.returnOrigin,
			new Date(expiresAt),
		],
	);

	// The signature covers the exact query string sent, without sig and key.
	const query = new URLSearchParams({
		domain: input.offer.zone,
		host: input.offer.host,
		redirect_uri: returnUrl(state),
		state,
	}).toString();
	const sig = sign("sha256", Buffer.from(query), privateKey()).toString(
		"base64",
	);
	return `${input.offer.urlSyncUX}/v2/domainTemplates/providers/${encodeURIComponent(providerId())}/services/${SERVICE_ID}/apply?${query}&${new URLSearchParams({ sig, key: keyId })}`;
}

/** What the panel says after the return: see FLASH in the panel/dominio route. */
export type ConnectOutcome = "ok" | "pendiente" | "cancelado" | "error";

/**
 * Consumes the state (single use, signed, not expired, same domain still
 * configured) and runs the CNAME check. The check is the real proof: a
 * redirect without an error does not guarantee the record exists.
 * Returns null when the state is not valid.
 */
export async function finishDomainConnect(
	state: string,
	providerError: string | null,
): Promise<{ returnOrigin: string; outcome: ConnectOutcome } | null> {
	if (!/^[\w-]{10,40}\.[\w-]{22}$/.test(state)) return null;
	const { rows } = await pool.query<{
		organization_id: string;
		domain: string;
		return_origin: string;
		expires_at: Date;
	}>(
		`delete from tenancy.domain_connect_state where state_hash = $1
		 returning organization_id, domain, return_origin, expires_at`,
		[hashState(state)],
	);
	const stored = rows[0];
	if (!stored || stored.expires_at.getTime() < Date.now()) return null;
	const wanted = Buffer.from(
		signState(
			state.split(".")[0] ?? "",
			stored.organization_id,
			stored.domain,
			stored.expires_at.getTime(),
		),
	);
	const received = Buffer.from(state);
	if (wanted.length !== received.length || !timingSafeEqual(wanted, received)) {
		return null;
	}
	if (!(await isReturnOrigin(stored.organization_id, stored.return_origin))) {
		return null;
	}
	const returnOrigin = stored.return_origin;
	if (providerError) {
		return {
			returnOrigin,
			outcome: providerError === "access_denied" ? "cancelado" : "error",
		};
	}

	const current = await getDomainState(stored.organization_id);
	if (current.domain !== stored.domain)
		return { returnOrigin, outcome: "error" };
	await refreshDomain(stored.organization_id);
	const after = await getDomainState(stored.organization_id);
	return {
		returnOrigin,
		outcome:
			after.status === "active" || after.status === "issuing_certificate"
				? "ok"
				: "pendiente",
	};
}
