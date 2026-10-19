import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { resolveTenant } from "../modules/tenancy/application/resolve-tenant.ts";
import { getTenantDirectory } from "./container.server.ts";
import { getEnv } from "./env.server.ts";

export const getHostResolution = createServerFn({ method: "GET" }).handler(
	async () =>
		resolveTenant(getRequestHeader("host") ?? "", {
			directory: getTenantDirectory(),
			config: { platformDomain: getEnv().PLATFORM_DOMAIN },
		}),
);
