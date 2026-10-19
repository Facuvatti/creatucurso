import { getRequest } from "@tanstack/react-start/server";
import { can } from "../modules/identity/domain/can.ts";
import { resolveTenant } from "../modules/tenancy/application/resolve-tenant.ts";
import { auth } from "./auth.server.ts";
import { getMembershipReader, getTenantDirectory } from "./container.server.ts";
import { appOrigin, getEnv } from "./env.server.ts";

export async function readRequestContext() {
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
}

export type RequestContext = Awaited<ReturnType<typeof readRequestContext>>;

/** The request must come from a creator's site. */
export async function requireTenantContext() {
	const context = await readRequestContext();
	const { host } = context;
	if (host.kind !== "tenant") throw new Error("Not found");
	return { ...context, tenant: host.tenant };
}

/** The request must come from the owner or an admin of this creator's site. */
export async function requireStaffContext() {
	const context = await requireTenantContext();
	const { user } = context;
	if (!user || !can(context.roles, { course: ["update"] })) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return { ...context, user };
}
