import type { Pool } from "pg";

export type UserDirectory = {
	findIdByEmail(email: string): Promise<string | null>;
};

export function createPgUserDirectory(pool: Pool): UserDirectory {
	return {
		async findIdByEmail(email) {
			const { rows } = await pool.query<{ id: string }>(
				`select id from auth."user" where lower(email) = lower($1) limit 1`,
				[email.trim()],
			);
			return rows[0]?.id ?? null;
		},
	};
}
