import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveTenant } from "../modules/tenancy/application/resolve-tenant.ts";
import { auth } from "./auth.server.ts";
import { getMembershipReader, getTenantDirectory } from "./container.server.ts";
import { appOrigin, getEnv } from "./env.server.ts";

export const getRequestContext = createServerFn({ method: "GET" }).handler(
	async () => {
		const request = getRequest();
		const hostHeader = request.headers.get("host") ?? "";
		const env = getEnv();

		const host = await resolveTenant(hostHeader, {
			directory: getTenantDirectory(),
			config: { platformDomain: env.PLATFORM_DOMAIN },
		});
		if (host.kind === "unknown") {
			return {
				host,
				user: null,
				roles: [] as string[],
				origin: "",
				appOrigin: "",
			};
		}

		const session = await auth.api.getSession({ headers: request.headers });
		const user = session
			? {
					id: session.user.id,
					name: session.user.name,
					email: session.user.email,
				}
			: null;
		const roles =
			host.kind === "tenant" && user
				? await getMembershipReader().findRoles(host.tenant.id, user.id)
				: [];

		return {
			host,
			user,
			roles,
			origin: `${env.PUBLIC_URL_SCHEME}://${hostHeader}`,
			appOrigin: appOrigin(),
		};
	},
);
