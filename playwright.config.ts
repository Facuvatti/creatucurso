import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl, port } from "./e2e/support.ts";

export default defineConfig({
	testDir: "e2e",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://localhost:${port}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `pnpm build && PORT=${port} pnpm start`,
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: {
			DATABASE_URL: e2eDatabaseUrl,
			PLATFORM_DOMAIN: "localhost",
			BETTER_AUTH_SECRET: "e2e-only-secret-not-for-production-use-0123456789",
			BETTER_AUTH_URL: `http://app.localhost:${port}`,
		},
	},
});
