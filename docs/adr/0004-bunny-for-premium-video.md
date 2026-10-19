# ADR-0004: Bunny Stream with MediaCage DRM for the Premium video tier

**Status:** On hold (the owner asked to compare other providers first; see ADR-0005)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

The Premium plan needs real DRM, per-tenant usage reports for monthly billing (Phase 8), and a player that can be fed short-lived access tokens by our backend. The owner chose Bunny as the provider.

Verified in the Bunny documentation:
- A video library can be created through the API (`POST /videolibrary`), so one library per tenant can be provisioned automatically.
- `GET /videolibrary/{id}` returns `TrafficUsage` (this month) and `StorageUsage`. `GET /videolibrary/{id}/drm/statistics` returns total DRM licenses issued and a chart over time.
- Embed view tokens are signed server-side (HMAC-SHA256 over the library API key, video id and expiry; the docs example uses 5 minutes) and, when enabled, also protect the Enterprise DRM license endpoint.
- **MediaCage Basic** is enabled from the dashboard and protects against casual downloads.
- **MediaCage Enterprise** documents FairPlay and Widevine (PlayReady is not listed), hardware-based key exchange, and screen-grab protection, which is **not available on Widevine L3** clients. It is a premium feature that needs coordination with Bunny's sales team to activate.
- Multi-key licensing means one playback can issue and bill several licenses (the docs give an example of 6 licenses for one playback).
- For Widevine L3 clients, Bunny's own guide caps quality at 480p.
- The library watermark is a single static image uploaded per library (`PUT /videolibrary/{id}/watermark`). A per-viewer dynamic watermark was not found.

Not verified: prices (storage, bandwidth, per-license), limits on the number of libraries, whether the Basic DRM could replace the self-hosted Basic tier, and PlayReady need in practice.

## Decision

- The Premium tier uses **Bunny Stream with MediaCage Enterprise DRM**, with **one Bunny library per Premium tenant**, created through the API when the tenant opts into Premium.
- The library API key stays on the server, encrypted per tenant. The browser only receives short-lived embed view tokens, issued after our backend checks enrollment.
- The **dynamic watermark with the student's email or ID is our own player overlay**, used in both tiers. Bunny's static watermark can be used for tenant branding.
- Usage metering reads `TrafficUsage`, `StorageUsage` and the DRM statistics per tenant library. `TrafficUsage` is a monthly cumulative counter, so the daily value is the difference between consecutive readings. License counts come from Bunny, not from our play counts, because of multi-key licensing.
- Product claims about blocking screen recording are limited to devices that actually get hardware-level protection; Widevine L3 devices do not.

## Options Considered

### Option A: Bunny Stream with MediaCage Enterprise (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Not yet known (per-license pricing and sales activation) |
| Scalability | Good (library per tenant via API) |
| Team familiarity | Low |

**Pros:** real DRM, per-library statistics, API-driven provisioning, one vendor for storage, delivery and DRM.
**Cons:** activation goes through sales; screen-grab protection does not apply to Widevine L3; license billing is multiplied by multi-key behavior; no per-viewer watermark.

### Option B: VdoCipher
Not evaluated in depth, because the owner chose Bunny. Revisit if Bunny's activation, pricing or watermark limits turn out to be blockers.

### Option C: Self-hosted encryption only (the Basic tier design)
Cheaper and fully under our control, but it is not DRM and gives no hardware-level protection.

## Trade-off Analysis

Bunny gives the DRM and the per-tenant usage data the billing model needs, at the cost of vendor dependence and a sales-gated activation. The dynamic watermark is the main gap and is filled by our overlay, which is visible in screen recordings but removable by a determined user with browser tools.

## Consequences

- Easier: usage-based monthly billing per tenant, because libraries are per tenant and expose usage and license statistics.
- Harder: the daily usage job must turn a cumulative counter into daily deltas and handle the monthly reset; cost forecasting is uncertain until license prices are known.
- Revisit: VdoCipher if Bunny blocks on activation or pricing; whether MediaCage Basic can replace the self-hosted Basic tier (less code to own, one library cost per tenant).

## Action Items

1. [ ] Contact Bunny sales to activate Enterprise DRM and get per-license, storage and bandwidth prices.
2. [ ] Confirm the maximum number of video libraries per account.
3. [ ] Test real behavior on target devices: Widevine L1 vs L3, Safari/FairPlay, Edge on Windows, with a screen-recording attempt each.
4. [ ] Decide whether the Basic tier uses MediaCage Basic or the self-hosted AES-128 design.
5. [ ] Phase 7: token issuance service, library provisioning, encrypted per-tenant key storage.
6. [ ] Phase 8: daily delta job for `TrafficUsage`, plus license statistics.
