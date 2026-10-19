import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	PLATFORM_DOMAIN: z.string().min(1).default("localhost"),
});

let cached: z.output<typeof envSchema> | undefined;

export function getEnv() {
	cached ??= envSchema.parse(process.env);
	return cached;
}
