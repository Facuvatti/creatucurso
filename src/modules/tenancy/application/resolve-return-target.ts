import { resolveTenant, type TenantDirectory } from "./resolve-tenant.ts";

export type ReturnTarget = { origin: string; path: string };

type Dependencies = {
	directory: TenantDirectory;
	platformDomain: string;
	allowedProtocol: "http:" | "https:";
};

/**
 * Validates the address a visitor wants to come back to after logging in.
 * Only a known creator site is accepted, so the login can never redirect
 * to an arbitrary address.
 */
export async function resolveReturnTarget(
	returnUrl: string,
	{ directory, platformDomain, allowedProtocol }: Dependencies,
): Promise<ReturnTarget | null> {
	let url: URL;
	try {
		url = new URL(returnUrl);
	} catch {
		return null;
	}

	if (url.protocol !== allowedProtocol || url.username || url.password) {
		return null;
	}

	const resolution = await resolveTenant(url.host, {
		directory,
		config: { platformDomain },
	});
	if (resolution.kind !== "tenant") return null;

	return { origin: url.origin, path: `${url.pathname}${url.search}` };
}
