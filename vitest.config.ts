import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx", "database/**/*.test.ts"],
		testTimeout: 15_000,
		hookTimeout: 30_000,
	},
});
