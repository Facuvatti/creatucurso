# ADR-0005: Premium video provider comparison (Bunny, VdoCipher, EZDRM, DoveRunner/PallyCon)

**Status:** Proposed (decision pending vendor answers; ADR-0004 on hold)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

The Premium plan needs real DRM. Creators are billed monthly for usage (Phase 8), so we need cost and usage that can be attributed per tenant. ADR-0004 evaluated Bunny; the owner asked to compare EZDRM, VdoCipher and PallyCon before committing.

Confidence legend: **P** = read on the vendor's own page, **S** = secondary (search snippet or review site; confirm with the vendor), **U** = unknown.

## Findings

| | Bunny Stream | VdoCipher | EZDRM | DoveRunner (formerly PallyCon) |
|---|---|---|---|---|
| What it is | Hosting, encoding, CDN, player, DRM | Hosting, player, DRM, dynamic watermark (all in one) | **License service only**: we package, store and deliver the video ourselves (P) | **License service**, plus forensic watermarking sold separately (S) |
| Pricing model | Usage-based; Enterprise DRM activated through sales (P); prices U | Yearly plans with bandwidth and storage caps: Starter $149 (1,000 GB / 100 GB), Value $399, Express $699, Pro $1,599, Plus $4,999, Enterprise custom (S) | Monthly: single-DRM plans $99.99 with 10,000 licenses; Universal DRM $199.99; Universal Complete $299.99 with 20,000 licenses or 2,000 users and Widevine, PlayReady, FairPlay; setup fees $49.99 to $199.99; support from $49.99 (P) | Per monthly active user: Standard $299 per month up to 1,000 MAU, then $6.00 per 100 MAU up to 10K, $4.00 per 100 MAU up to 100K; Standard Plus $499 (S) |
| DRM systems | Widevine, FairPlay (PlayReady not listed) (P) | Widevine documented in plan listing; FairPlay mentioned for iOS Safari (S) | Widevine, FairPlay, PlayReady, WisePlay (P) | Widevine, FairPlay, PlayReady (S) |
| Dynamic per-viewer watermark | Not found; static image only (P) | Included in plans (S) | Not part of the license service (U) | Separate forensic watermarking product (S) |
| Per-tenant attribution | Library per tenant via API, with usage and license statistics (P) | Multiple customers on one account or on multiple accounts; per-account billing and per-customer reporting not confirmed (S, U) | One subscription; no multi-customer model described; per-tenant counts would come from our own token issuance (P, U) | One account; per-tenant counts from our own token issuance (U) |
| What we must still build | Little | Little | Packaging (CENC), storage, CDN delivery, player integration | Same as EZDRM |

Screen-recording protection is hardware-based and is the same story for every vendor. VdoCipher's own material states that Widevine L1 and FairPlay can black out recordings on supported phones and tablets and in iOS Safari, but that capture **cannot be prevented in any browser on Windows or Linux desktops** (S). Bunny's documentation likewise says screen-grab protection does not apply to Widevine L3 (P). Blocking OBS on a Windows or Linux desktop browser is therefore not something any of these providers can promise.

On the owner's question about a "fixed $100": the only fixed figure near $100 found is EZDRM's single-DRM plan ($99.99 per month), and it is per EZDRM subscription, not per tenant. VdoCipher's cheapest plan found is $149 per year with 1,000 GB bandwidth and 100 GB storage. Whether VdoCipher charges per account when serving several customers is not confirmed.

## Decision

No provider is chosen yet. Until the vendor answers below arrive, Bunny remains the working assumption because it is the only option confirmed to provide per-tenant libraries and per-library statistics through an API.

## Options Considered

### Option A: Bunny (ADR-0004)
**Pros:** per-tenant libraries and statistics via API; little to build.
**Cons:** sales-gated DRM, prices unknown, no per-viewer watermark, no PlayReady.

### Option B: VdoCipher
**Pros:** all in one, per-viewer dynamic watermark included, predictable yearly plans.
**Cons:** multi-tenant accounting and pricing unclear; bandwidth caps are per plan, not per tenant, so monthly per-tenant billing may need our own tracking; Widevine/FairPlay coverage to confirm.

### Option C: EZDRM or DoveRunner as license service
**Pros:** broad DRM coverage including PlayReady, flat or per-user pricing independent of how many tenants we have.
**Cons:** we must build and run packaging, storage, delivery and the player integration, which grows the platform's scope and operations; per-tenant usage would be derived from our own logs.

## Trade-off Analysis

The all-in-one providers (Bunny, VdoCipher) keep the scope small; the license-only providers (EZDRM, DoveRunner) give flexibility and coverage but add an entire video pipeline to build and run. The deciding factor is per-tenant cost attribution, because creators are billed monthly from it, and that is only confirmed for Bunny.

## Consequences

- If a license-only provider is chosen, the Basic tier's encrypted HLS pipeline could be extended to produce DRM-packaged output, so the work is shared between tiers.
- Marketing and the landing page must not promise blocking of screen recording on desktop browsers on any provider.

## Action Items

1. [ ] Ask VdoCipher: can one account serve many tenants with separated usage reports (folders, tags, or sub-accounts)? Is each account billed separately? Is there an API for per-customer bandwidth and storage? Is FairPlay included in all plans?
2. [ ] Ask Bunny: price of Enterprise DRM per license, storage and bandwidth, and the maximum number of libraries.
3. [ ] Ask EZDRM: overage price per extra license and whether usage is reported per key or content group.
4. [ ] Re-read the pricing pages that returned errors or were only seen through search snippets (VdoCipher, DoveRunner) before relying on the numbers.
5. [ ] Decide the provider and mark ADR-0004 or this ADR as accepted; the other becomes superseded.

## Sources

- EZDRM pricing page: https://www.ezdrm.com/service-pricing
- VdoCipher plans (secondary listing in search results) and VdoCipher blog on serving multiple customers: https://www.vdocipher.com/blog/multiple-accounts-projects
- VdoCipher on screen capture: https://www.vdocipher.com/blog/screen-capture-block-video
- DoveRunner price models: https://doverunner.com/blogs/doverunner-new-price-models/
- Bunny documentation: https://bunny.net/docs/stream/drm
