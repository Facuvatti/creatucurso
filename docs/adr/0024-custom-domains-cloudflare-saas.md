# ADR-0024: Custom domains with Cloudflare for SaaS

**Status:** Accepted
**Date:** 2026-10-20

## Context
The server has no open ports: everything goes through a Cloudflare Tunnel. Caddy on-demand TLS (ADR-0018) cannot issue certificates there, because the ACME challenge never reaches the machine. Creators still need `cursos.maria.com` to work with HTTPS.

## Decision
- Use **Cloudflare for SaaS Custom Hostnames**. The creator only types the domain in the panel and creates one DNS record at their registrar: `CNAME cursos -> dominios.<PLATFORM_DOMAIN>` (the fallback origin; env `CUSTOM_DOMAIN_TARGET`).
- Ownership is proven by that CNAME (`resolveCname`, one extra hop allowed). The old TXT token is gone. Apex domains cannot have a CNAME: the panel asks for a subdomain such as `cursos.*` or `www.*`.
- Once the CNAME resolves, the app registers the custom hostname through the API (`src/areas/tenancy/cloudflare.ts`, DCV method `http`, TLS 1.2+), stores its id in `tenancy.domain_check` and sets `customDomainVerifiedAt`. State: `pending_dns` -> `issuing_certificate` -> `active` (or `error` with a Spanish reason).
- The panel button "Verificar ahora" and a worker job (every minute) run the same function, `refreshDomain`. It is idempotent: it looks the hostname up before creating it.
- Removing or changing the domain deletes the custom hostname in Cloudflare.
- Without `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` the feature is off and the panel says so.

## Host handling
Cloudflare for SaaS forwards the customer's hostname in the `Host` header, and `cloudflared` keeps it, so `resolveTenant(host)` works unchanged for verified custom domains. `X-Forwarded-Host` is **not** trusted. Sessions are host-only cookies created by the existing handoff flow, which already accepts custom domains. The tenant cache clears when a domain is verified or removed (misses are cached 5 s).

## Alternative kept
With a public IP, Caddy on-demand TLS and `GET /ask` (ADR-0018) still work: `/ask` only needs `customDomainVerifiedAt`, which the CNAME check sets.

## Consequences
Cloudflare is required for custom domains. The platform zone needs Custom Hostnames enabled (billing applies after the free quota), a fallback origin and an API token. The tunnel needs a catch-all ingress so unknown hostnames reach the app. See `docs/cloudflare.md`.
