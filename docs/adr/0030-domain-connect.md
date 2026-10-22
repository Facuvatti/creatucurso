# ADR-0030: One-click custom domains with Domain Connect

**Status:** Accepted
**Date:** 2026-10-21

## Context
With ADR-0024 the creator types `cursos.maria.com` in the panel and then creates one record at their DNS provider: `CNAME cursos -> dominios.<PLATFORM_DOMAIN>`. Editing DNS is the step most creators get wrong or abandon. A CNAME must exist at the creator's DNS provider; we cannot avoid it, but the provider can create it for them.

## Decision
- Use **Domain Connect** (open protocol, https://github.com/Domain-Connect/spec), **synchronous flow with signed requests**. We publish one service template, `infra/domain-connect/creatucurso.com.ar.customdomain.json` (providerId = platform domain, serviceId `customdomain`): one `CNAME @ -> dominios.<PLATFORM_DOMAIN>` applied with a `host` (`hostRequired: true`; the protocol puts the record at `<host>.<domain>`, so `%host%` must not appear in the record).
- **Discovery** (`src/areas/tenancy/domain-connect.ts`): the zone is the closest parent of the domain with its own NS records (`cursos.maria.com` -> zone `maria.com`, host `cursos`). We read the `_domainconnect.<zone>` TXT, call `https://<value>/v2/<zone>/settings`, then `{urlAPI}/v2/domainTemplates/providers/<providerId>/services/customdomain` (2xx = supported). Both URLs come from data anyone can publish, so requests go only over https to public addresses (checked at connect time), follow no redirects, time out after 5 s and read at most 64 KB. Answers are cached 10 minutes. Any failure means "not supported".
- **Apply**: the panel shows "Conectar automáticamente con <provider>". The server builds `{urlSyncUX}/v2/domainTemplates/providers/<providerId>/services/customdomain/apply?domain=&host=&redirect_uri=&state=` and signs that exact query string with RS256 (RSA PKCS#1 v1.5, SHA-256, base64), appending `sig` and `key` (the TXT host of the public key under `syncPubKeyDomain`).
- **Return**: `redirect_uri` is `https://app.<PLATFORM_DOMAIN>/api/domain-connect/return/<state>` (inside `syncRedirectDomain`). The state is in the path because some providers (Cloudflare) do not send `state` back. It is short, HMAC-signed (key derived from `SECRETS_ENCRYPTION_KEY`), single use (row in `tenancy.domain_connect_state`, deleted when read), expires in 30 minutes and is bound to the academy and the domain. The return only runs the existing idempotent CNAME check (`refreshDomain`) and sends the owner back to `/panel/dominio`; Cloudflare custom hostname and certificate continue as in ADR-0024, and the worker keeps checking every minute. A redirect without an error is not proof: only the DNS check is.
- **Fallback**: when the provider does not support the template, the key is not configured or discovery fails, the panel shows the manual CNAME instructions exactly as before.

## Template onboarding
DNS providers support a template only after onboarding it. We submit it as a pull request to https://github.com/Domain-Connect/Templates and, for Cloudflare, also email domain-connect@cloudflare.com. Each provider decides on its own and it can take weeks; until a provider accepts it, its customers see only the manual instructions. Steps in `docs/domain-connect-setup.md`.

## Consequences
- A key pair to keep: the private key in env (`DOMAIN_CONNECT_PRIVATE_KEY`, `DOMAIN_CONNECT_KEY_ID`), the public key in TXT records. Rotation = publish a new key under a new TXT name, then switch `DOMAIN_CONNECT_KEY_ID`.
- Changing `CUSTOM_DOMAIN_TARGET`, the platform domain or the app host means a new template version and new onboarding.
- No asynchronous (OAuth) flow: few providers offer it and each needs a separate integration.
