function originFor(subdomain: string): string {
	const scheme = process.env.PUBLIC_URL_SCHEME ?? "https";
	const domain = process.env.PLATFORM_DOMAIN ?? "localhost";
	const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "";
	return `${scheme}://${subdomain}.${domain}${port}`;
}

/** Public URL of a creator's free subdomain, for example http://maria.localhost:4310 */
export function tenantOrigin(slug: string): string {
	return originFor(slug);
}

/** Public URL of the central app, for example http://app.localhost:4310 */
export function appOrigin(): string {
	return originFor("app");
}
