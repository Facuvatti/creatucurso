export type HostClassification =
	| { kind: "landing" }
	| { kind: "platform-app" }
	| { kind: "subdomain"; slug: string }
	| { kind: "custom-domain"; domain: string }
	| { kind: "unknown" };

export type HostConfig = {
	platformDomain: string;
};

export const RESERVED_SUBDOMAINS = new Set([
	"api",
	"admin",
	"mail",
	"static",
	"cdn",
	"media",
]);
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const UNKNOWN: HostClassification = { kind: "unknown" };

function normalize(host: string): string {
	return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

function isValidName(name: string): boolean {
	return (
		name !== "" &&
		!IPV4.test(name) &&
		name.split(".").every((label) => DNS_LABEL.test(label))
	);
}

export function classifyHost(
	host: string,
	config: HostConfig,
): HostClassification {
	const name = normalize(host);
	if (!isValidName(name)) return UNKNOWN;

	const platform = config.platformDomain;
	if (name === platform || name === `www.${platform}`) {
		return { kind: "landing" };
	}
	if (name === `app.${platform}`) return { kind: "platform-app" };

	if (name.endsWith(`.${platform}`)) {
		const slug = name.slice(0, -(platform.length + 1));
		if (slug.includes(".") || RESERVED_SUBDOMAINS.has(slug)) return UNKNOWN;
		return { kind: "subdomain", slug };
	}

	if (!name.includes(".")) return UNKNOWN;
	return { kind: "custom-domain", domain: name };
}
