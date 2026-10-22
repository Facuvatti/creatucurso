import { createServerFn } from "@tanstack/react-start";
import {
	findDomainConnect,
	startDomainConnect,
} from "../areas/tenancy/domain-connect.ts";
import {
	type DomainState,
	getDomainState,
	refreshDomain,
	removeDomain,
	requestDomain,
	validateCustomDomain,
} from "../areas/tenancy/domains.ts";
import { record, text } from "../shared/validate.ts";
import { requireTenantContext } from "./request.server.ts";

export type { DomainState };
export type DomainResult = { ok: true } | { ok: false; message: string };
/** `connectProvider`: DNS provider that can apply the CNAME for the owner (Domain Connect), or null. */
export type DomainPanel = DomainState & { connectProvider: string | null };

const waitingForDns = (state: DomainState) =>
	Boolean(
		state.domain &&
			(state.status === "pending_dns" || state.status === "error"),
	);

/** Only the owner manages the custom domain. */
async function requireOwner() {
	const context = await requireTenantContext();
	if (!context.user || !context.roles.includes("owner")) {
		throw new Error("No tenés permiso para hacer esto.");
	}
	return { ...context, user: context.user };
}

export const getDomainPanel = createServerFn({ method: "GET" }).handler(
	async (): Promise<DomainPanel> => {
		const { tenant } = await requireOwner();
		const state = await getDomainState(tenant.id);
		const offer =
			state.domain && waitingForDns(state)
				? await findDomainConnect(state.domain)
				: null;
		return { ...state, connectProvider: offer?.providerName ?? null };
	},
);

/** Owner is sent to the DNS provider to apply our CNAME template (Domain Connect). */
export const connectDomain = createServerFn({ method: "POST" }).handler(
	async (): Promise<
		{ ok: true; url: string } | { ok: false; message: string }
	> => {
		const { tenant, user, origin } = await requireOwner();
		const state = await getDomainState(tenant.id);
		const offer =
			state.domain && waitingForDns(state)
				? await findDomainConnect(state.domain)
				: null;
		if (!state.domain || !offer) {
			return {
				ok: false,
				message:
					"La conexión automática no está disponible para este dominio. Creá el registro a mano.",
			};
		}
		try {
			const url = await startDomainConnect({
				organizationId: tenant.id,
				userId: user.id,
				domain: state.domain,
				returnOrigin: origin,
				offer,
			});
			return { ok: true, url };
		} catch (error) {
			console.error(
				"Starting Domain Connect failed",
				error instanceof Error ? error.name : "unknown",
			);
			return {
				ok: false,
				message:
					"No pudimos iniciar la conexión automática. Creá el registro a mano o intentá de nuevo.",
			};
		}
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
		await refreshDomain(tenant.id);
		const state = await getDomainState(tenant.id);
		return state.status === "pending_dns" || state.status === "error"
			? { ok: false, message: state.reason ?? "Todavía no está listo." }
			: { ok: true };
	},
);

export const deleteDomain = createServerFn({ method: "POST" }).handler(
	async (): Promise<DomainResult> => {
		const { tenant } = await requireOwner();
		await removeDomain(tenant.id);
		return { ok: true };
	},
);
