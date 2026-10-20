import { createServerFn } from "@tanstack/react-start";
import {
	type DomainState,
	getDomainState,
	removeDomain,
	requestDomain,
	validateCustomDomain,
	verifyDomain,
} from "../areas/tenancy/domains.ts";
import { record, text } from "../shared/validate.ts";
import { requireTenantContext } from "./request.server.ts";

export type { DomainState };
export type DomainResult = { ok: true } | { ok: false; message: string };

/** Only the owner manages the custom domain. */
async function requireOwner() {
	const context = await requireTenantContext();
	if (!context.user || !context.roles.includes("owner")) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return context;
}

export const getDomainPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<DomainState> => {
		const { tenant } = await requireOwner();
		return getDomainState(tenant.id);
	},
);

export const saveDomain = createServerFn({ method: "POST" })
	.validator((data: unknown) => ({
		domain: text(record(data), "domain", 253, 3).toLowerCase(),
	}))
	.handler(async ({ data }): Promise<DomainResult> => {
		const { tenant } = await requireOwner();
		const message = validateCustomDomain(data.domain);
		if (message) return { ok: false, message };
		const taken = await requestDomain(tenant.id, data.domain);
		return taken ? { ok: false, message: taken } : { ok: true };
	});

export const checkDomain = createServerFn({ method: "POST" }).handler(
	async (): Promise<DomainResult> => {
		const { tenant } = await requireOwner();
		return (await verifyDomain(tenant.id))
			? { ok: true }
			: {
					ok: false,
					message:
						"Todavía no vemos el registro TXT. Los cambios de DNS pueden tardar unos minutos.",
				};
	},
);

export const deleteDomain = createServerFn({ method: "POST" }).handler(
	async (): Promise<DomainResult> => {
		const { tenant } = await requireOwner();
		await removeDomain(tenant.id);
		return { ok: true };
	},
);
