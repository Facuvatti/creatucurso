import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	PLATFORM_DOMAIN: z.string().min(1).default("localhost"),
	PUBLIC_URL_SCHEME: z.enum(["http", "https"]).default("https"),
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

/** Public URL of a creator's free subdomain, for example http://maria.localhost:3000 */
export function tenantOrigin(slug: string): string {
	return originFor(slug);
}

/** Public URL of the central app, for example http://app.localhost:3000 */
export function appOrigin(): string {
	return originFor("app");
}
