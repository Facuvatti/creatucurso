# ADR-0031: Apex (root) custom domains

**Status:** Accepted (owner decision, 2026-10-22: apex via A record is allowed)
**Date:** 2026-10-22

## Context
ADR-0024 only accepted subdomains (`cursos.maria.com`, CNAME to `dominios.<PLATFORM_DOMAIN>`), because an apex domain (`maria.com`) cannot hold a CNAME. The owner wants creators to be able to connect the whole domain with an A record. Our app has no public origin IP (Cloudflare Tunnel), so the A record must point at an IP that routes into our Cloudflare for SaaS zone.

## Finding: what Cloudflare documents
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/ : "If your customer needs to use an A record to point to the SaaS target, you will need to get apex proxying. By default, using an A record to point to the target is not a supported setup."
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/ : "Apex proxying allows your customers to use their apex domains (`example.com`) with your SaaS application." Cloudflare assigns a set of Static IP prefixes to your account (or you bring your own with BYOIP); "Only certain customers have access to this feature"; the cost and the IPs come from "your account team".
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/ : the plans table lists apex proxying / BYOIP as "No" for Free, Pro and Business and "Paid add-on" for Enterprise.

Conclusion: there are **no public fixed anycast IPs** for custom hostnames. The apex IPs are assigned per account and only to Enterprise accounts with the apex proxying add-on. A guessed IP would send creators' traffic nowhere (or to a stranger), so we hardcode nothing.

## Decision
- `CUSTOM_DOMAIN_APEX_IPV4` (comma-separated) and optional `CUSTOM_DOMAIN_APEX_IPV6` are env vars **the owner must fill** with the addresses Cloudflare assigns. Empty by default.
- **Apex only works once `CUSTOM_DOMAIN_APEX_IPV4` is set.** Until then the panel rejects a root domain with a clear message and keeps asking for a subdomain. The subdomain path is unchanged.
- To get the IPs: ask the Cloudflare account team for the apex proxying add-on (Enterprise), have the static IPs assigned to the zone, then copy them into the env.
- `kind` (`subdomain` | `apex`) is stored in `tenancy.domain_check`. The kind comes from the number of labels, treating common second-level suffixes (`com.ar`, `com.br`, `co.uk`, ...) as part of the suffix; there is no public-suffix list dependency.
- **Verification:** subdomain = CNAME to the target (as before). Apex = A records from `resolve4` must be non-empty and all inside `CUSTOM_DOMAIN_APEX_IPV4`; any AAAA must be inside `CUSTOM_DOMAIN_APEX_IPV6` (an AAAA elsewhere would split traffic). The Cloudflare custom hostname creation is identical for both kinds.
- **Domain Connect:** one service (`customdomain`, version 2) with two record groups. Group `subdomain`: `CNAME @ -> dominios.<PLATFORM_DOMAIN>`. Group `apex`: `A @ -> %ipv4%`. The app sends `groupId=subdomain|apex` (spec: "If no group is specified, all groups are applied"), `host=<label>` or empty for apex ("A value of @ for host in the template is a placeholder for an empty value"), and `ipv4=<first configured IP>` as a template variable. All of it is inside the signed query string. `hostRequired` is dropped because apex has no host. Only the first IPv4 is applied by Domain Connect; the manual instructions list all of them. No AAAA record in the template (a variable the app cannot always supply would make the apply fail).
- The panel recommends also adding `www` for apex domains (a note; no redirect is built).

## Consequences
- The template changes (version 2): providers that already accepted version 1 must be told to update it.
- Providers that ignore `groupId` would apply both records; unsupported behaviour is covered by the DNS check (nothing is marked verified unless the right records exist).
