import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { PostgresDialect } from "kysely";
import { ac, roles } from "../areas/identity/permissions.ts";
import { validateTenantSlug } from "../areas/tenancy/tenants.ts";
import { pool } from "./db.server.ts";

const google =
	process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
		? {
				socialProviders: {
					google: {
						clientId: process.env.GOOGLE_CLIENT_ID,
						clientSecret: process.env.GOOGLE_CLIENT_SECRET,
					},
				},
			}
		: {};

export const auth = betterAuth({
	appName: "Creatucurso",
	database: {
		dialect: new PostgresDialect({ pool }),
		type: "postgres",
		schemaName: "auth",
	},
	emailAndPassword: { enabled: true },
	...google,
	user: {
		additionalFields: {
			isCreator: {
				type: "boolean",
				required: false,
				defaultValue: false,
				input: false,
			},
		},
	},
	plugins: [
		organization({
			ac,
			roles,
			allowUserToCreateOrganization: (user) =>
				(user as { isCreator?: boolean }).isCreator === true,
			organizationHooks: {
				beforeCreateOrganization: async ({ organization }) => {
					const message = validateTenantSlug(organization.slug ?? "");
					if (message) throw new APIError("BAD_REQUEST", { message });
				},
			},
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
		tanstackStartCookies(),
	],
});
