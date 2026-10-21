import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { listMemberships } from "../areas/identity/members.ts";
import { validateTenantSlug } from "../areas/tenancy/tenants.ts";
import { record, text } from "../shared/validate.ts";
import { auth } from "./auth.server.ts";
import { tenantOrigin } from "./origins.server.ts";

export type CreateAcademyResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

export const createAcademy = createServerFn({ method: "POST" })
	.validator((data: unknown) => {
		const input = record(data);
		return {
			name: text(input, "name", 100, 2),
			slug: text(input, "slug", 200).toLowerCase(),
		};
	})
	.handler(async ({ data }): Promise<CreateAcademyResult> => {
		const { headers } = getRequest();
		const session = await auth.api.getSession({ headers });
		if (!session) return { ok: false, message: "Tenés que iniciar sesión." };

		const slugError = validateTenantSlug(data.slug);
		if (slugError) return { ok: false, message: slugError };

		const context = await auth.$context;
		await context.internalAdapter.updateUser(session.user.id, {
			isCreator: true,
		});

		try {
			const organization = await auth.api.createOrganization({
				body: { name: data.name, slug: data.slug },
				headers,
			});
			return { ok: true, url: `${tenantOrigin(organization.slug)}/` };
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: "No pudimos crear la academia.";
			return { ok: false, message };
		}
	});

export type AppHome = {
	academies: { name: string; url: string }[];
	studying: { name: string; url: string }[];
};

export const getAppHome = createServerFn({ method: "GET" }).handler(
	async (): Promise<AppHome> => {
		const session = await auth.api.getSession({
			headers: getRequest().headers,
		});
		if (!session) return { academies: [], studying: [] };

		const memberships = await listMemberships(session.user.id);
		const toLink = (m: (typeof memberships)[number]) => ({
			name: m.name,
			url: `${tenantOrigin(m.slug)}/`,
		});

		return {
			academies: memberships
				.filter((m) => m.roles.some((r) => r === "owner" || r === "admin"))
				.map(toLink),
			studying: memberships
				.filter((m) => m.roles.includes("student"))
				.map(toLink),
		};
	},
);
