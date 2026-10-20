import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { isServedDomain } from "../areas/tenancy/domains.ts";

const PRIVATE_IPV4 =
	/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

function isInternal(address: string): boolean {
	const ip = address.replace(/^::ffff:/i, "").toLowerCase();
	return (
		PRIVATE_IPV4.test(ip) ||
		ip === "::1" ||
		ip.startsWith("fc") ||
		ip.startsWith("fd") ||
		ip.startsWith("fe80")
	);
}

// Caddy "on_demand_tls { ask }" endpoint (plan: Custom domains and TLS).
// Caddy calls it on an internal URL, for example http://app:3000/ask?domain=x.com,
// directly (not through its own reverse proxy), so there is no X-Forwarded-For.
// A request that came through the public proxy carries the visitor's address in
// X-Forwarded-For and is refused, as is any non-private peer address.
export const Route = createFileRoute("/ask")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const peer = getRequestIP();
				const forwarded = request.headers.get("x-forwarded-for");
				const addresses = [
					...(forwarded ? forwarded.split(",").map((a) => a.trim()) : []),
					...(peer ? [peer] : []),
				];
				if (!peer || !addresses.every(isInternal)) {
					return new Response("Not found", { status: 404 });
				}

				const domain = new URL(request.url).searchParams.get("domain");
				if (!domain || !(await isServedDomain(domain.toLowerCase()))) {
					return new Response("Not found", { status: 404 });
				}
				return new Response("ok", { status: 200 });
			},
		},
	},
});
