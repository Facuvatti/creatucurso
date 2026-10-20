import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { pool } from "../../server/db.server.ts";
import { classifyHost } from "./classify-host.ts";

export const VERIFY_PREFIX = "_creatucurso-verify";

export type DomainState = {
	domain: string | null;
	verified: boolean;
	/** DNS TXT record the creator must add. Null when there is no pending domain. */
	txtName: string | null;
	txtValue: string | null;
};

/** Error message, or null when the text can be used as a custom domain. */
export function validateCustomDomain(domain: string): string | null {
	const platform = process.env.PLATFORM_DOMAIN ?? "localhost";
	if (
		domain.length > 253 ||
		domain.endsWith(`.${platform}`) ||
		domain === platform
	) {
		return "Ese dominio no se puede usar.";
	}
	if (
		classifyHost(domain, { platformDomain: platform }).kind !== "custom-domain"
	) {
		return "Ingresá un dominio válido, por ejemplo cursos.tudominio.com.";
	}
	return null;
}

export async function getDomainState(
	organizationId: string,
): Promise<DomainState> {
	const { rows } = await pool.query<{
		domain: string | null;
		verified: boolean;
		token: string | null;
	}>(
		`select o."customDomain" as domain,
		        o."customDomainVerifiedAt" is not null as verified,
		        c.token
		 from auth.organization o
		 left join tenancy.domain_check c on c.organization_id = o.id
		 where o.id = $1`,
		[organizationId],
	);
	const row = rows[0];
	if (!row?.domain) {
		return { domain: null, verified: false, txtName: null, txtValue: null };
	}
	return {
		domain: row.domain,
		verified: row.verified,
		txtName: row.verified ? null : `${VERIFY_PREFIX}.${row.domain}`,
		txtValue: row.verified ? null : row.token,
	};
}

/** Saves a domain as pending and creates its DNS token. Returns an error message or null. */
export async function requestDomain(
	organizationId: string,
	domain: string,
): Promise<string | null> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query(
			`update auth.organization
			 set "customDomain" = $2, "customDomainVerifiedAt" = null where id = $1`,
			[organizationId, domain],
		);
		await client.query(
			`insert into tenancy.domain_check (organization_id, token)
			 values ($1, $2)
			 on conflict (organization_id) do update set token = excluded.token, created_at = now()`,
			[organizationId, randomBytes(24).toString("hex")],
		);
		await client.query("commit");
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

/** Looks for the TXT token in DNS; marks the domain verified when found. */
export async function verifyDomain(organizationId: string): Promise<boolean> {
	const state = await getDomainState(organizationId);
	if (!state.domain || !state.txtName || !state.txtValue) return state.verified;

	let records: string[][];
	try {
		records = await resolveTxt(state.txtName);
	} catch {
		return false;
	}
	const found = records.some((chunks) => chunks.join("") === state.txtValue);
	if (!found) return false;

	await pool.query(
		`update auth.organization set "customDomainVerifiedAt" = now()
		 where id = $1 and "customDomain" = $2`,
		[organizationId, state.domain],
	);
	return true;
}

export async function removeDomain(organizationId: string): Promise<void> {
	await pool.query(
		`update auth.organization
		 set "customDomain" = null, "customDomainVerifiedAt" = null where id = $1`,
		[organizationId],
	);
	await pool.query(
		`delete from tenancy.domain_check where organization_id = $1`,
		[organizationId],
	);
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
