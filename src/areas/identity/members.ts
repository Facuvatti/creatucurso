import { pool } from "../../server/db.server.ts";

export type Membership = {
	organizationId: string;
	slug: string;
	name: string;
	roles: string[];
};

const splitRoles = (value: string) =>
	value
		.split(",")
		.map((role) => role.trim())
		.filter(Boolean);

/** Roles a person has in an academy (empty when they are not a member). */
export async function findRoles(
	organizationId: string,
	userId: string,
): Promise<string[]> {
	const { rows } = await pool.query<{ role: string }>(
		`select role from auth.member where "organizationId" = $1 and "userId" = $2 limit 1`,
		[organizationId, userId],
	);
	return rows[0] ? splitRoles(rows[0].role) : [];
}

export async function listMemberships(userId: string): Promise<Membership[]> {
	const { rows } = await pool.query<{
		organizationId: string;
		slug: string;
		name: string;
		role: string;
	}>(
		`select o.id as "organizationId", o.slug, o.name, m.role
		 from auth.member m
		 join auth.organization o on o.id = m."organizationId"
		 where m."userId" = $1
		 order by o.name`,
		[userId],
	);
	return rows.map((row) => ({
		organizationId: row.organizationId,
		slug: row.slug,
		name: row.name,
		roles: splitRoles(row.role),
	}));
}

/** Adds a role to an existing member without removing the roles they already have. */
export async function addRole(
	organizationId: string,
	userId: string,
	role: string,
): Promise<void> {
	await pool.query(
		`update auth.member set role = role || ',' || $3
		 where "organizationId" = $1 and "userId" = $2
		   and (',' || role || ',') not like '%,' || $3 || ',%'`,
		[organizationId, userId, role],
	);
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
	const { rows } = await pool.query<{ id: string }>(
		`select id from auth."user" where lower(email) = lower($1) limit 1`,
		[email.trim()],
	);
	return rows[0]?.id ?? null;
}
