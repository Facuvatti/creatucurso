import { resolveCname } from "node:dns/promises";
import { pool } from "../../server/db.server.ts";
import { classifyHost } from "./classify-host.ts";
import {
	CloudflareError,
	type CustomHostname,
	cloudflareEnabled,
	createHostname,
	deleteHostname,
	findHostname,
	getHostname,
} from "./cloudflare.ts";
import { forgetTenantCache } from "./tenants.ts";

export type DomainStatus =
	| "pending_dns"
	| "issuing_certificate"
	| "active"
	| "error";

export type DomainState = {
	/** False when the platform has no Cloudflare credentials. */
	enabled: boolean;
	domain: string | null;
	status: DomainStatus | null;
	reason: string | null;
	/** The record is CNAME <name> -> <target>. */
	cnameName: string | null;
	cnameTarget: string;
};

/** Second-level public suffixes, so maria.com.ar counts as a root domain. */
const SECOND_LEVEL_SUFFIXES = new Set([
	"com.ar",
	"net.ar",
	"org.ar",
	"gob.ar",
	"edu.ar",
	"com.br",
	"net.br",
	"org.br",
	"com.mx",
	"com.co",
	"com.uy",
	"com.cl",
	"com.pe",
	"com.ve",
	"com.bo",
	"com.py",
	"com.ec",
	"co.uk",
	"org.uk",
	"co.nz",
	"com.au",
]);

/** A root domain (maria.com, maria.com.ar) has no subdomain label above it. */
function isRootDomain(domain: string): boolean {
	const labels = domain.split(".");
	return (
		labels.length <= 2 ||
		(labels.length === 3 &&
			SECOND_LEVEL_SUFFIXES.has(labels.slice(1).join(".")))
	);
}

/** Fallback origin: the name every creator's CNAME must point to. */
export function customDomainTarget(): string {
	const platform = process.env.PLATFORM_DOMAIN ?? "localhost";
	return (
		process.env.CUSTOM_DOMAIN_TARGET || `dominios.${platform}`
	).toLowerCase();
}

/** Error message, or null when the text can be used as a custom domain. */
export function validateCustomDomain(domain: string): string | null {
	const platform = process.env.PLATFORM_DOMAIN ?? "localhost";
	if (
		domain.length > 253 ||
		domain.endsWith(`.${platform}`) ||
		domain === platform ||
		domain === customDomainTarget()
	) {
		return "Ese dominio no se puede usar.";
	}
	if (
		classifyHost(domain, { platformDomain: platform }).kind !== "custom-domain"
	) {
		return "Ingresá un dominio válido, por ejemplo cursos.tudominio.com.";
	}
	if (isRootDomain(domain)) {
		return "No se pueden conectar dominios principales (tudominio.com). Usá un subdominio, por ejemplo cursos.tudominio.com o www.tudominio.com.";
	}
	return null;
}

export async function getDomainState(
	organizationId: string,
): Promise<DomainState> {
	const { rows } = await pool.query<{
		domain: string | null;
		verified: boolean;
		status: DomainStatus | null;
		reason: string | null;
	}>(
		`select o."customDomain" as domain,
		        o."customDomainVerifiedAt" is not null as verified,
c.status, c.status_reason as reason
		 from auth.organization o
		 left join tenancy.domain_check c on c.organization_id = o.id
		 where o.id = $1`,
		[organizationId],
	);
	const row = rows[0];
	const base = {
		enabled: cloudflareEnabled(),
		cnameTarget: customDomainTarget(),
	};
	if (!row?.domain) {
		return {
			...base,
			domain: null,
			status: null,
			reason: null,
			cnameName: null,
		};
	}
	return {
		...base,
		domain: row.domain,
		status: row.status ?? (row.verified ? "active" : "pending_dns"),
		reason: row.reason,
		cnameName: row.domain.split(".")[0] ?? row.domain,
	};
}

/** Saves a domain as pending DNS. Returns an error message or null. */
export async function requestDomain(
	organizationId: string,
	domain: string,
): Promise<string | null> {
	if (!cloudflareEnabled()) return "Los dominios propios no están habilitados.";
	// A previous domain must not stay registered in Cloudflare.
	await dropHostname(organizationId);

	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query(
			`update auth.organization
			 set "customDomain" = $2, "customDomainVerifiedAt" = null where id = $1`,
			[organizationId, domain],
		);
		await client.query(
			`insert into tenancy.domain_check (organization_id)
values ($1)
on conflict (organization_id) do update
set cloudflare_hostname_id = null, status = 'pending_dns',
status_reason = null, last_checked_at = null, created_at = now()`,
			[organizationId],
		);
		await client.query("commit");
		forgetTenantCache();
		return null;
	} catch (error) {
		await client.query("rollback");
		if ((error as { code?: string }).code === "23505") {
			return "Ese dominio ya está en uso por otra academia.";
		}
		throw error;
	} finally {
		client.release();
	}
}

/**
 * True when the domain is a CNAME to our target, following at most one extra
 * hop (domain -> other name -> target).
 */
async function pointsToTarget(domain: string): Promise<boolean> {
	const target = customDomainTarget();
	let name = domain;
	for (let hop = 0; hop < 2; hop++) {
		let names: string[];
		try {
			names = await resolveCname(name);
		} catch {
			return false;
		}
		const next = names[0]?.toLowerCase().replace(/\.$/, "");
		if (!next) return false;
		if (next === target) return true;
		name = next;
	}
	return false;
}

/** Spanish reason for a Cloudflare validation error. */
function reasonFor(errors: string[]): string {
	const first = errors[0] ?? "";
	if (/cname/i.test(first)) {
		return "Cloudflare no ve el registro DNS apuntando a la plataforma. Revisá el registro.";
	}
	return `Cloudflare no pudo validar el dominio${first ? ` (${first.slice(0, 120)})` : ""}.`;
}

async function save(
	organizationId: string,
	status: DomainStatus,
	reason: string | null,
	hostnameId?: string,
) {
	await pool.query(
		`update tenancy.domain_check
		 set status = $2, status_reason = $3, last_checked_at = now(),
		     cloudflare_hostname_id = coalesce($4, cloudflare_hostname_id)
		 where organization_id = $1`,
		[organizationId, status, reason, hostnameId ?? null],
	);
}

/** Maps what Cloudflare reports to our state. */
function statusOf(hostname: CustomHostname): [DomainStatus, string | null] {
	if (hostname.status === "active" && hostname.sslStatus === "active") {
		return ["active", null];
	}
	const dead =
		/timed_out$/.test(hostname.sslStatus) ||
		/^(blocked|deleted|moved)$/.test(hostname.status);
	if (hostname.verificationErrors.length > 0 || dead) {
		return ["error", reasonFor(hostname.verificationErrors)];
	}
	return ["issuing_certificate", null];
}

/**
 * Moves one domain forward: DNS check, one-time registration in Cloudflare and
 * certificate polling. Safe to repeat; used by the button and by the worker.
 */
export async function refreshDomain(organizationId: string): Promise<void> {
	if (!cloudflareEnabled()) return;
	const { rows } = await pool.query<{
		domain: string;
		hostname_id: string | null;
		status: DomainStatus;
	}>(
		`select o."customDomain" as domain,c.cloudflare_hostname_id as hostname_id, c.status
		 from tenancy.domain_check c
		 join auth.organization o on o.id = c.organization_id
		 where c.organization_id = $1 and o."customDomain" is not null`,
		[organizationId],
	);
	const row = rows[0];
	if (!row || row.status === "active") return;

	try {
		let hostnameId = row.hostname_id;
		if (!hostnameId) {
			if (!(await pointsToTarget(row.domain))) {
				await save(
					organizationId,
					"pending_dns",
					"Todavía no vemos el registro CNAME. Los cambios de DNS pueden tardar unos minutos.",
				);
				return;
			}
			const hostname =
				(await findHostname(row.domain)) ?? (await createHostname(row.domain));
			hostnameId = hostname.id;
			await pool.query(
				`update auth.organization set "customDomainVerifiedAt" = coalesce("customDomainVerifiedAt", now())
				 where id = $1 and "customDomain" = $2`,
				[organizationId, row.domain],
			);
			forgetTenantCache();
			await save(organizationId, ...statusOf(hostname), hostnameId);
			return;
		}

		const hostname = await getHostname(hostnameId);
		if (!hostname) {
			// Deleted on the Cloudflare side: register it again on the next check.
			await pool.query(
				`update tenancy.domain_check set cloudflare_hostname_id = null where organization_id = $1`,
				[organizationId],
			);
			await save(
				organizationId,
				"pending_dns",
				"Volvemos a registrar el dominio.",
			);
			return;
		}
		await save(organizationId, ...statusOf(hostname));
	} catch (error) {
		const codes =
			error instanceof CloudflareError
				? ` (código ${error.codes.join(", ") || error.status})`
				: "";
		await save(
			organizationId,
			"error",
			`No pudimos hablar con Cloudflare${codes}. Vamos a reintentar.`,
		);
	}
}

/** Worker job: advances every domain that is not active yet. */
export async function refreshPendingDomains(): Promise<void> {
	if (!cloudflareEnabled()) return;
	const { rows } = await pool.query<{ organization_id: string }>(
		`select organization_id from tenancy.domain_check where status <> 'active'`,
	);
	for (const row of rows) {
		try {
			await refreshDomain(row.organization_id);
		} catch (error) {
			console.log(
				JSON.stringify({
					level: "error",
					time: new Date().toISOString(),
					msg: "domain refresh failed",
					error: error instanceof Error ? error.name : "unknown",
				}),
			);
		}
	}
}

/** Deletes the Cloudflare custom hostname of an organization, if it has one. */
async function dropHostname(organizationId: string): Promise<void> {
	if (!cloudflareEnabled()) return;
	const { rows } = await pool.query<{ id: string | null }>(
		`select cloudflare_hostname_id as id from tenancy.domain_check where organization_id = $1`,
		[organizationId],
	);
	const id = rows[0]?.id;
	if (id) await deleteHostname(id);
}

export async function removeDomain(organizationId: string): Promise<void> {
	await dropHostname(organizationId);
	await pool.query(
		`update auth.organization
		 set "customDomain" = null, "customDomainVerifiedAt" = null where id = $1`,
		[organizationId],
	);
	await pool.query(
		`delete from tenancy.domain_check where organization_id = $1`,
		[organizationId],
	);
	forgetTenantCache();
}

/** Used by the Caddy `ask` endpoint. One indexed lookup (unique indexes on slug and customDomain). */
export async function isServedDomain(domain: string): Promise<boolean> {
	const platform = process.env.PLATFORM_DOMAIN ?? "localhost";
	const classification = classifyHost(domain, { platformDomain: platform });
	if (classification.kind === "subdomain") {
		const { rowCount } = await pool.query(
			`select 1 from auth.organization where slug = $1`,
			[classification.slug],
		);
		return rowCount === 1;
	}
	if (
		classification.kind === "platform-app" ||
		classification.kind === "landing"
	) {
		return true;
	}
	if (classification.kind !== "custom-domain") return false;
	const { rowCount } = await pool.query(
		`select 1 from auth.organization
		 where "customDomain" = $1 and "customDomainVerifiedAt" is not null`,
		[classification.domain],
	);
	return rowCount === 1;
}
