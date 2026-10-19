# ADR-0001: Cross-domain login handoff for tenant hosts

**Status:** Proposed (cookie behavior of the handoff must be proven by an integration test in Phase 2)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Each creator (tenant) is served on a free subdomain (`maria.example.com`) or on a custom domain (`maria-courses.com`). Login is centralized at `app.example.com` with a single OAuth callback, because OAuth providers only accept pre-registered redirect URIs and we cannot register one per customer domain.

A session cookie set by `app.example.com` is not sent to `maria-courses.com`. better-auth's `crossSubDomainCookies` accepts a single parent `domain`, so it can only cover subdomains of one parent, never custom domains.

Verified in the better-auth documentation:
- The `oneTimeToken` plugin generates a single-use token attached to the caller's active session, valid for 3 minutes by default (`expiresIn`, in minutes), and `verify` returns the session attached to it. The docs describe it as the way to transfer a session across domains.
- Options: `disableClientRequest` (generate only on the server), `storeToken: "hashed"` (hash the token at rest).
- `trustedOrigins` accepts an async function of the request, so the allowlist can come from the database.
- `baseURL` accepts `allowedHosts`, so one instance can serve several hosts.

Not yet verified: whether `verify` also emits the session cookie on the verifying host. The design does not depend on it (see Consequences).

## Decision

Authenticate only at `app.example.com` and hand the session to each tenant host with a one-time token, **for free subdomains and custom domains alike**. Tenant hosts use host-only session cookies. `crossSubDomainCookies` stays disabled.

Flow:
1. A visitor on a tenant host needs a session and is redirected to `https://app.example.com/login?return=<tenant URL>`.
2. `app.example.com` validates the `return` host against the tenant host list in the database (verified subdomain or verified custom domain). Anything else is rejected.
3. After login (or immediately if already logged in), `app.example.com` generates a one-time token server-side and redirects to `https://<tenant host>/auth/handoff?token=...&next=/relative/path`.
4. The tenant host verifies the token server-side, creates a host-only session cookie, and redirects to `next`, which must be a relative path.
5. Logout on a tenant host clears its cookie and revokes that session; logout on `app.example.com` revokes all of the user's sessions.

## Options Considered

### Option A: `crossSubDomainCookies` for subdomains, handoff only for custom domains
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium (two mechanisms) |
| Cost | Low |
| Scalability | Good |
| Team familiarity | High |

**Pros:** no redirect round trip on free subdomains.
**Cons:** two code paths to test; the session cookie is sent to every tenant subdomain, and tenant-authored content (course descriptions, lesson text) runs on those origins, so a content injection on one tenant would be same-site with `app.example.com` and with every other tenant.

### Option B: one-time token handoff for every tenant host (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium (one mechanism, one more route) |
| Cost | Low |
| Scalability | Good |
| Team familiarity | Medium |

**Pros:** a single path for all hosts; host-only cookies isolate tenants from each other; works for any custom domain with no per-domain configuration.
**Cons:** one extra redirect on the first visit to each tenant (invisible when already logged in); the token travels in a URL.

### Option C: run login and OAuth on each tenant host
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | Medium |
| Scalability | Poor |
| Team familiarity | Medium |

**Pros:** no handoff.
**Cons:** requires registering a redirect URI per customer domain at every OAuth provider, which is not possible for arbitrary custom domains, and it contradicts the single-callback requirement.

## Trade-off Analysis

Option A saves one redirect on subdomains but pays with a second mechanism and a wider cookie scope that is risky when tenants author content. Option B accepts one redirect to get a uniform, isolated model. Option C is not viable with OAuth providers.

## Consequences

- Easier: a single login mechanism; adding a custom domain needs no auth configuration beyond adding it to the verified host list; one tenant's origin cannot use another tenant's session cookie.
- Harder: the token appears in URLs, so mitigate with `expiresIn: 1`, `storeToken: "hashed"`, `disableClientRequest: true`, an immediate redirect that drops the token from the address bar, and `Referrer-Policy: no-referrer` on the handoff route.
- Open-redirect surface: both the `return` host and `next` path are validated (host against the database list, `next` as a relative path only).
- If `verify` does not set the cookie itself, the handoff route creates the session cookie from the returned session. Either way, an integration test must prove that a request to the tenant host carries a valid host-only session after the handoff, and that revoking the session at `app.example.com` invalidates it on the tenant host.
- Revisit: the extra redirect if first-visit latency matters; Option A only if tenant content is never user-authored.

## Action Items

1. [ ] Phase 2: integration test for the handoff (token single-use, expiry, host validation, revocation).
2. [ ] Phase 2: `tenant_host` list (verified subdomains and custom domains) as the single source for `return` validation and `trustedOrigins`.
3. [ ] Phase 2: `Referrer-Policy` and token-stripping redirect on `/auth/handoff`.
4. [ ] Phase 1 design doc: how custom domains get verified (DNS proof) before they enter the host list.
