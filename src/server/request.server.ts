import { getRequest } from "@tanstack/react-start/server";
import {
	academyBillingState,
	type BillingStatus,
} from "../areas/billing/billing.ts";
import { findRoles } from "../areas/identity/members.ts";
import { can } from "../areas/identity/permissions.ts";
import { resolveTenant } from "../areas/tenancy/tenants.ts";
import { auth } from "./auth.server.ts";
import { appOrigin } from "./origins.server.ts";

export async function readRequestContext() {
	const request = getRequest();
	const hostHeader = request.headers.get("host") ?? "";

	const host = await resolveTenant(hostHeader);
	if (host.kind === "unknown") {
		return {
			host,
			user: null,
			roles: [] as string[],
			origin: "",
			appOrigin: "",
			billing: null as AcademyBilling | null,
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
			? await findRoles(host.tenant.id, user.id)
			: [];
	// The tenant layout shows the past-due / suspended notices (ADR-0029).
	let billing: AcademyBilling | null = null;
	if (host.kind === "tenant") {
		const state = await academyBillingState(host.tenant.id);
		billing = {
			status: state.status,
			suspendAt: state.suspendAt?.toISOString() ?? null,
		};
	}

	return {
		host,
		user,
		roles,
		origin: `${process.env.PUBLIC_URL_SCHEME ?? "https"}://${hostHeader}`,
		appOrigin: appOrigin(),
		billing,
	};
}

export type AcademyBilling = {
	status: BillingStatus;
	suspendAt: string | null;
};

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
