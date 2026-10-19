# ADR-0012: Basic video tier continues under bandwidth limits

**Status:** Accepted conditionally (a load test must confirm the numbers)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

In the Basic tier our own server delivers the encrypted HLS segments. The owner measured **114 Mbps of upstream**. The rule set by the owner: if the tier does not work even with lower quality and a cap on simultaneous viewers, drop it; otherwise continue with those limitations.

Estimate (assumptions, not measurements): keep about 20 percent of the upstream free for the rest of the traffic, leaving about 90 Mbit/s for video.
- 720p at about 2.5 Mbit/s: roughly 35 simultaneous viewers.
- 480p at about 1.2 Mbit/s: roughly 75 simultaneous viewers.
HLS players download in bursts, so real peaks exceed these averages.

## Decision

Continue with the Basic tier under these limits:
1. Quality ladder capped at 480p (about 1.2 Mbit/s) and 720p (about 2.5 Mbit/s); no higher renditions.
2. A configurable global cap on simultaneous Basic streams, initially **30**. Playbacks beyond the cap get a clear "try again in a few minutes" response.
3. The `media` deployable unit (packaging, key server, segment delivery) is separate, so it can later move behind a CDN or to a faster connection.
4. A load test before launch with simulated viewers, while also requesting normal site pages, confirms the numbers. Proposed drop criterion: if the server cannot sustain at least 20 simultaneous 480p streams while the site stays responsive, the Basic tier is dropped. The owner can adjust that threshold.

## Options Considered

- **Continue with limits (chosen):** fits the owner's rule; small scale only.
- **Drop the Basic tier:** simplest, but leaves no low-cost plan.
- **CDN in front of the origin:** removes the bandwidth ceiling but adds a vendor and cost; kept as the upgrade path.

## Consequences

- The Basic tier is suitable for small audiences; the Premium tier (provider-delivered) is the path for larger ones.
- The video plan shown to creators must state the concurrency limit honestly.
- Revisit: after the load test and after real usage data.

## Action Items

1. [ ] Phase 6: admission control (cap, configurable), capped rendition ladder.
2. [ ] Phase 6: load test script and a written result.
3. [ ] Show the Basic-tier limits in the plan description.
