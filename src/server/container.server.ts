import { Pool } from "pg";
import {
	createPgMembershipReader,
	type MembershipReader,
} from "../modules/identity/infrastructure/pg-membership-reader.ts";
import { createCachedTenantDirectory } from "../modules/tenancy/infrastructure/cached-tenant-directory.ts";
import { createPgTenantDirectory } from "../modules/tenancy/infrastructure/pg-tenant-directory.ts";
import { getEnv } from "./env.server.ts";

let pool: Pool | undefined;
let tenantDirectory: ReturnType<typeof createCachedTenantDirectory> | undefined;

export function getPool() {
	pool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
	return pool;
}

let membershipReader: MembershipReader | undefined;

export function getMembershipReader() {
	membershipReader ??= createPgMembershipReader(getPool());
	return membershipReader;
}

export function getTenantDirectory() {
	tenantDirectory ??= createCachedTenantDirectory(
		createPgTenantDirectory(getPool()),
		{ ttlMs: 60_000, missTtlMs: 5_000, maxEntries: 1_000 },
	);
	return tenantDirectory;
}
