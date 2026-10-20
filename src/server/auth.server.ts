import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { PostgresDialect } from "kysely";
import { ac, roles } from "../areas/identity/permissions.ts";
import { validateTenantSlug } from "../areas/tenancy/tenants.ts";
import { pool } from "./db.server.ts";
import { escapeHtml, sendEmail } from "./email.server.ts";

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
	// Email verification is sent on sign-up but does not block login
	// (requireEmailVerification stays off), so the flow works before an email
	// provider is configured. Turn it on once Resend is set up.
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => {
			// Not awaited, so a slow provider does not make sign-up slow.
			void sendEmail({
				to: user.email,
				subject: "Confirmá tu email en Creatucurso",
				text: `Hola ${user.name}, confirmá tu email entrando a este enlace: ${url}`,
				html: `<p>Hola ${escapeHtml(user.name)},</p><p><a href="${url}">Confirmá tu email</a></p>`,
			}).catch((error) => console.error("[email] verification failed", error));
		},
	},
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ user, url }) => {
			void sendEmail({
				to: user.email,
				subject: "Restablecé tu contraseña de Creatucurso",
				text: `Hola ${user.name}, para elegir una contraseña nueva entrá a este enlace (vence en 1 hora): ${url}\n\nSi no lo pediste, ignorá este mensaje.`,
				html: `<p>Hola ${escapeHtml(user.name)},</p><p><a href="${url}">Elegí una contraseña nueva</a> (el enlace vence en 1 hora).</p><p>Si no lo pediste, ignorá este mensaje.</p>`,
			}).catch((error) => console.error("[email] reset failed", error));
		},
	},
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
