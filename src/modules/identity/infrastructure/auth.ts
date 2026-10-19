import { betterAuth } from "better-auth";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";

export const auth = betterAuth({
	database: {
		dialect: new PostgresDialect({
			pool: new Pool({ connectionString: process.env.DATABASE_URL }),
		}),
		type: "postgres",
		schemaName: "auth",
	},
	emailAndPassword: { enabled: true },
	plugins: [
		organization({
			schema: {
				organization: {
					additionalFields: {
						customDomain: {
							type: "string",
							required: false,
							unique: true,
							input: false,
						},
						customDomainVerifiedAt: {
							type: "date",
							required: false,
							input: false,
						},
						hyperswitchMerchantId: {
							type: "string",
							required: false,
							input: false,
						},
						hyperswitchProfileId: {
							type: "string",
							required: false,
							input: false,
						},
						videoPlan: {
							type: "string",
							required: true,
							defaultValue: "basic",
							input: false,
						},
						drmLibraryId: { type: "string", required: false, input: false },
					},
				},
			},
		}),
		admin(),
		twoFactor(),
		oneTimeToken({
			expiresIn: 1,
			storeToken: "hashed",
			disableClientRequest: true,
		}),
	],
});
