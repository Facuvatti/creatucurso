import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { validateTenantSlug } from "../modules/tenancy/domain/tenant-slug.ts";
import { auth } from "./auth.server.ts";
import { getMembershipReader } from "./container.server.ts";
import { tenantOrigin } from "./env.server.ts";

const createAcademyInput = z.object({
	name: z.string().trim().min(2).max(100),
	slug: z.string().trim().toLowerCase(),
});

export type CreateAcademyResult =
	| { ok: true; url: string }
	| { ok: false; message: string };

export const createAcademy = createServerFn({ method: "POST" })
	.validator((data: unknown) => createAcademyInput.parse(data))
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

		const memberships = await getMembershipReader().listForUser(
			session.user.id,
		);
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
