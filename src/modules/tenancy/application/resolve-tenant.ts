import { classifyHost, type HostConfig } from "../domain/classify-host.ts";
import type { Tenant } from "../domain/tenant.ts";

export interface TenantDirectory {
	findBySlug(slug: string): Promise<Tenant | null>;
	findByVerifiedCustomDomain(domain: string): Promise<Tenant | null>;
}

export type HostResolution =
	| { kind: "landing" }
	| { kind: "platform-app" }
	| { kind: "tenant"; tenant: Tenant }
	| { kind: "unknown" };

type Dependencies = {
	directory: TenantDirectory;
	config: HostConfig;
};

export async function resolveTenant(
	host: string,
	{ directory, config }: Dependencies,
): Promise<HostResolution> {
	const classification = classifyHost(host, config);

	switch (classification.kind) {
		case "landing":
		case "platform-app":
		case "unknown":
			return { kind: classification.kind };
		case "subdomain":
			return toResolution(await directory.findBySlug(classification.slug));
		case "custom-domain":
			return toResolution(
				await directory.findByVerifiedCustomDomain(classification.domain),
			);
	}
}

function toResolution(tenant: Tenant | null): HostResolution {
	return tenant ? { kind: "tenant", tenant } : { kind: "unknown" };
}
