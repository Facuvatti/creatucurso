import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	PLATFORM_DOMAIN: z.string().min(1).default("localhost"),
	PUBLIC_URL_SCHEME: z.enum(["http", "https"]).default("https"),
	// Payments are optional: without these the sites work and selling is disabled.
	SECRETS_ENCRYPTION_KEY: z.string().optional(),
	HYPERSWITCH_URL: z.string().url().optional(),
	HYPERSWITCH_ADMIN_API_KEY: z.string().optional(),
	/** Address Hyperswitch uses to call this app (webhooks). */
	HYPERSWITCH_WEBHOOK_BASE_URL: z.string().url().optional(),
	/** Address of Hyperswitch as the browser sees it (defaults to HYPERSWITCH_URL). */
	HYPERSWITCH_PUBLIC_URL: z.string().url().optional(),
	/** Where the browser loads the Hyperswitch checkout script from. */
	HYPERSWITCH_SDK_URL: z.string().url().optional(),
	PUBLIC_PORT: z
		.string()
		.regex(/^\d+$/)
		.optional()
		.transform((value) => value || undefined),
});

let cached: z.output<typeof envSchema> | undefined;

export function getEnv() {
	cached ??= envSchema.parse(process.env);
	return cached;
}

function originFor(subdomain: string): string {
	const { PUBLIC_URL_SCHEME, PLATFORM_DOMAIN, PUBLIC_PORT } = getEnv();
	const port = PUBLIC_PORT ? `:${PUBLIC_PORT}` : "";
	return `${PUBLIC_URL_SCHEME}://${subdomain}.${PLATFORM_DOMAIN}${port}`;
}

export type PaymentsConfig = {
	secretsKey: string;
	gatewayUrl: string;
	adminApiKey: string;
	webhookBaseUrl: string;
	sdkUrl: string;
	publicUrl: string;
};

/** Settings for selling courses, or null when payments are not configured. */
export function getPaymentsConfig(): PaymentsConfig | null {
	const env = getEnv();
	if (
		!env.SECRETS_ENCRYPTION_KEY ||
		!env.HYPERSWITCH_URL ||
		!env.HYPERSWITCH_ADMIN_API_KEY
	) {
		return null;
	}
	return {
		secretsKey: env.SECRETS_ENCRYPTION_KEY,
		gatewayUrl: env.HYPERSWITCH_URL,
		adminApiKey: env.HYPERSWITCH_ADMIN_API_KEY,
		webhookBaseUrl: env.HYPERSWITCH_WEBHOOK_BASE_URL ?? appOrigin(),
		publicUrl: env.HYPERSWITCH_PUBLIC_URL ?? env.HYPERSWITCH_URL,
		sdkUrl:
			env.HYPERSWITCH_SDK_URL ??
			"https://beta.hyperswitch.io/v1/HyperLoader.js",
	};
}

/** Public URL of a creator's free subdomain, for example http://maria.localhost:3000 */
export function tenantOrigin(slug: string): string {
	return originFor(slug);
}

/** Public URL of the central app, for example http://app.localhost:3000 */
export function appOrigin(): string {
	return originFor("app");
}
