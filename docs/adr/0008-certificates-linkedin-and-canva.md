# ADR-0008: Certificate sharing on LinkedIn and frame creation with Canva

**Status:** Proposed (exact frame size rules are defined when the certificates phase starts)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Certificates are stored and shared through a public link carrying the credential ID, so students can add them to LinkedIn. Creators design the certificate frame in Canva (or elsewhere) and upload the file.

Findings:
- **LinkedIn (official help article):** developers can now use a **static URL** for Add to Profile; links "will no longer be customized for a specific certificate or degree". Existing customized buttons keep working but send the user to the new experience **without auto-filling** certificate information. This supersedes the earlier version of this ADR, which relied on a pre-filled URL (`startTask=CERTIFICATION_NAME&name=...&certUrl=...&certId=...`) found in third-party pages.
- **Canva:** the editor cannot be embedded in an iframe (Canva sends a `frame-ancestors none` policy, per search results). The Canva Button SDK can open a new design with custom dimensions (`data-design-dimensions-width`, `-height`, `-units`). The Canva Connect API can export designs (PNG, JPG, PDF) with OAuth and `design:content:read`, with download URLs valid for 24 hours. A plain public link that opens a blank canvas at a given size was not found.

## Decision

- **LinkedIn:** the public certificate page shows the fields a student needs to paste into LinkedIn's add-certification form (name, issuer, issue date, credential URL, credential ID), each with a copy button, plus a link to LinkedIn's form. The certificate page's own URL is also shareable as a normal link. No pre-filled URL is generated.
- **Canva, v1:** the creator sees a link to Canva together with the exact size to use, designs the frame there, and uploads the exported file. No Canva integration and no OAuth in v1. If Canva offers a link that opens a blank canvas with the required proportion, we use it; otherwise the instructions state the size.
- **Canva, later option:** the Canva Button SDK (custom dimensions) if the manual flow proves to be a friction point.
- **Uploaded file rules:** PDF and safe raster images (PNG, JPEG) are accepted. SVG and any format that can carry active content are rejected. The validator:
  - detects the real file type from the content (magic bytes), not from the extension or the declared MIME type;
  - enforces maximum bytes and maximum pixel dimensions (protection against decompression bombs);
  - re-encodes images server-side, which strips metadata and embedded payloads;
  - flattens a PDF into an image (first page) so no scripts, forms or embedded files are kept.
  Exact dimensions or aspect ratio and size limits are decided when the certificates phase starts.

## Options Considered

- **Link-out plus upload (chosen):** least work, no external approval, safe because everything uploaded is re-encoded.
- **Canva Connect API import:** smoother for creators, but needs OAuth, app review and rate-limit handling, and still needs the same validator.
- **Canva Button SDK:** embedded flow with a fixed size, a good later upgrade.

## Consequences

- Easier: no dependency on Canva's approval; one validation path for every file.
- Harder: creators must follow the size instructions themselves; students paste fields into LinkedIn manually.
- Revisit: the Canva Button SDK, and whether LinkedIn's static Add to Profile URL is useful once its current behavior is tested with a real account.

## Action Items

1. [ ] Test LinkedIn's current add-certification form with a real account and decide the exact copy-field order.
2. [ ] Phase 11: validator tests (SVG rejected, wrong extension but valid content, oversized dimensions, PDF with scripts flattened).
3. [ ] Phase 11: check whether a Canva link with a preset size exists; otherwise show the size in the instructions.
4. [ ] Owner defines the frame size and weight limits when the phase starts.

## Sources

- LinkedIn Add to Profile help article: https://www.linkedin.com/help/linkedin/answer/a528030
- Canva Button API reference: https://www.canva.dev/docs/button/html/api-reference
- Canva export job endpoint: https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/
