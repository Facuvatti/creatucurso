import { Pool } from "pg";
import type { CatalogRepository } from "../modules/catalog/application/catalog-repository.ts";
import { createPgCatalogRepository } from "../modules/catalog/infrastructure/pg-catalog-repository.ts";
import {
	createPgMembershipReader,
	type MembershipReader,
} from "../modules/identity/infrastructure/pg-membership-reader.ts";
import {
	createPgUserDirectory,
	type UserDirectory,
} from "../modules/identity/infrastructure/pg-user-directory.ts";
import type {
	PaymentGateway,
	PaymentRepository,
} from "../modules/payments/application/ports.ts";
import { createHyperswitchGateway } from "../modules/payments/infrastructure/hyperswitch-gateway.ts";
import { createPgPaymentRepository } from "../modules/payments/infrastructure/pg-payment-repository.ts";
import { createCachedTenantDirectory } from "../modules/tenancy/infrastructure/cached-tenant-directory.ts";
import { createPgTenantDirectory } from "../modules/tenancy/infrastructure/pg-tenant-directory.ts";
import { decryptSecret, encryptSecret } from "../shared/crypto/secret-box.ts";
import { getEnv, getPaymentsConfig } from "./env.server.ts";

let pool: Pool | undefined;
let tenantDirectory: ReturnType<typeof createCachedTenantDirectory> | undefined;

export function getPool() {
	pool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
	return pool;
}

export type Payments = {
	gateway: PaymentGateway;
	repository: PaymentRepository;
	webhookBaseUrl: string;
	sdkUrl: string;
	publicUrl: string;
};

let payments: Payments | null | undefined;

/** The payment setup, or null when payments are not configured. */
export function getPayments(): Payments | null {
	if (payments !== undefined) return payments;
	const config = getPaymentsConfig();
	payments = config
		? {
				gateway: createHyperswitchGateway({
					baseUrl: config.gatewayUrl,
					adminApiKey: config.adminApiKey,
				}),
				repository: createPgPaymentRepository(getPool(), {
					encrypt: (plain) => encryptSecret(plain, config.secretsKey),
					decrypt: (box) => decryptSecret(box, config.secretsKey),
				}),
				webhookBaseUrl: config.webhookBaseUrl,
				sdkUrl: config.sdkUrl,
				publicUrl: config.publicUrl,
			}
		: null;
	return payments;
}

let catalog: CatalogRepository | undefined;
let userDirectory: UserDirectory | undefined;
let membershipReader: MembershipReader | undefined;

export function getCatalog() {
	catalog ??= createPgCatalogRepository(getPool());
	return catalog;
}

export function getUserDirectory() {
	userDirectory ??= createPgUserDirectory(getPool());
	return userDirectory;
}

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
