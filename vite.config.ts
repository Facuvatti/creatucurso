import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	// Creator sites use many hostnames (subdomains and custom domains).
	server: { host: true, allowedHosts: true },
	plugins: [
		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			// The platform itself can only be framed by its own origin; apps embedded
			// as lessons are the ones framed (see docs/lesson-sdk.md).
			routeRules: {
				"/**": {
					headers: { "Content-Security-Policy": "frame-ancestors 'self'" },
				},
			},
		}),

		tanstackStart(),
		viteReact(),
	],
});

export default config;
