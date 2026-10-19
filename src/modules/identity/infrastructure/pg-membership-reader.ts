import type { Pool } from "pg";
import { z } from "zod";

export type Membership = {
	organizationId: string;
	slug: string;
	name: string;
	roles: string[];
};

export type MembershipReader = {
	findRoles(organizationId: string, userId: string): Promise<string[]>;
	listForUser(userId: string): Promise<Membership[]>;
};

const splitRoles = (value: string) =>
	value
		.split(",")
		.map((role) => role.trim())
		.filter(Boolean);

const roleRow = z.object({ role: z.string() });
const membershipRow = z.object({
	organizationId: z.string(),
	slug: z.string(),
	name: z.string(),
	role: z.string(),
});

export function createPgMembershipReader(pool: Pool): MembershipReader {
	return {
		async findRoles(organizationId, userId) {
			const { rows } = await pool.query(
				`select role from auth.member where "organizationId" = $1 and "userId" = $2 limit 1`,
				[organizationId, userId],
			);
			return rows[0] ? splitRoles(roleRow.parse(rows[0]).role) : [];
		},
		async listForUser(userId) {
			const { rows } = await pool.query(
				`select o.id as "organizationId", o.slug, o.name, m.role
				 from auth.member m
				 join auth.organization o on o.id = m."organizationId"
				 where m."userId" = $1
				 order by o.name`,
				[userId],
			);
			return rows.map((row) => {
				const parsed = membershipRow.parse(row);
				return {
					organizationId: parsed.organizationId,
					slug: parsed.slug,
					name: parsed.name,
					roles: splitRoles(parsed.role),
				};
			});
		},
	};
}
