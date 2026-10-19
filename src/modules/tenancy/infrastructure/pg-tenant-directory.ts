import type { Pool } from "pg";
import { z } from "zod";
import type { TenantDirectory } from "../application/resolve-tenant.ts";
import type { Tenant } from "../domain/tenant.ts";

const row = z.object({ id: z.string(), slug: z.string(), name: z.string() });

export function createPgTenantDirectory(pool: Pool): TenantDirectory {
	async function findOne(
		condition: string,
		value: string,
	): Promise<Tenant | null> {
		const { rows } = await pool.query(
			`select id, slug, name from auth.organization where ${condition} limit 1`,
			[value],
		);
		return rows[0] ? row.parse(rows[0]) : null;
	}

	return {
		findBySlug: (slug) => findOne("slug = $1", slug),
		findByVerifiedCustomDomain: (domain) =>
			findOne(
				`"customDomain" = $1 and "customDomainVerifiedAt" is not null`,
				domain,
			),
	};
}
