# ADR-0018: Caddy on-demand TLS and wildcard certificate

**Status:** Accepted (design; the Phase 14 agent implements and tests it)
**Date:** 2026-10-20

## Context
Creators use free subdomains (`maria.<PLATFORM_DOMAIN>`) or verified custom domains. Both need HTTPS on a Raspberry-class server without per-domain manual work.

## Decision
- **Free subdomains:** one wildcard certificate `*.<PLATFORM_DOMAIN>` using the ACME DNS-01 challenge. This needs a DNS provider plugin in a custom Caddy build (`xcaddy build --with github.com/caddy-dns/<provider>`) and an API token in the environment. Apex and `app.` are covered by the same site block.
- **Custom domains:** Caddy on-demand TLS. Before issuing a certificate Caddy calls our `GET /ask?domain=<host>` on an internal URL. The app (`src/routes/ask.ts`) answers 200 only for a domain with `customDomainVerifiedAt` set (or a known free subdomain), otherwise 404. It refuses any caller whose address, or `X-Forwarded-For`, is not loopback/private.

Caddyfile sketch (the `ask` URL is the internal compose address of the web service, never the public host):

```
{
	on_demand_tls {
		ask http://web:3000/ask
	}
}

*.example.com, example.com {
	tls {
		dns <provider> {env.DNS_API_TOKEN}
	}
	reverse_proxy web:3000
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy web:3000
}
```

Caddy calls `ask` directly, so the request has no `X-Forwarded-For`. The same path reached through the public proxy carries the visitor address and is refused.

## Fallbacks
- No DNS plugin for the provider: use per-subdomain on-demand TLS for `*.example.com` too (the `ask` endpoint already accepts known slugs); mind Let's Encrypt rate limits (50 certificates per registered domain per week).
- Let's Encrypt rate limits for custom domains are per domain, so they are not a concern per creator.

## Consequences
`ask` must stay a single indexed lookup (unique indexes on `slug` and `customDomain`). Caddy must be able to reach the web service on the internal network. Certificate storage needs a persistent volume.
