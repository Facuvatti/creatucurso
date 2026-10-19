# ADR-0008: Certificate sharing on LinkedIn and frame import from Canva

**Status:** Proposed (the frame size rules still need the owner's numbers)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Certificates are stored and shared by a public link carrying the credential ID, so students can add them to LinkedIn. Creators can import the certificate frame from Canva or upload a file that meets a size rule.

Findings (secondary sources included; re-check at implementation):
- **LinkedIn "Add to profile":** a URL of the form `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=...&organizationId=... (or organizationName=...)&issueYear=...&issueMonth=...&expirationYear=...&expirationMonth=...&certUrl=...&certId=...`. `organizationId` and `organizationName` cannot be used together; use `organizationName` when the issuer has no LinkedIn page. `certUrl` should be URL-encoded.
- **Canva Connect API:** exports are created with `POST https://api.canva.com/rest/v1/exports` using an OAuth token with the `design:content:read` scope. Formats include PNG, JPG and PDF. Exports are asynchronous jobs; download URLs are valid for 24 hours. Rate limits found: 75 exports per user per 5 minutes and 500 per user per day.

## Decision

- **LinkedIn:** build the add-to-profile URL on the server for each certificate with `name` = course title, issuer = the tenant (`organizationName` unless the tenant has configured a LinkedIn organization ID), issue year and month from the certificate, `certUrl` = the public share link, and `certId` = the credential ID. The share page itself is the verification page.
- **Canva import:** the creator connects their Canva account with OAuth, picks a design, and our server creates a PNG or PDF export job, downloads the result immediately, and stores our own copy. The imported file goes through the same validator as an uploaded file.
- **One validator for both sources:** accepted file type, exact pixel dimensions or aspect ratio, and maximum bytes. Rejections return a clear message saying which rule failed.

## Options Considered

- **Import from Canva plus upload (chosen):** matches the requirement; costs an OAuth integration with Canva.
- **Upload only:** simplest; loses the Canva convenience the owner asked for.

## Consequences

- Easier: students share certificates with one click; the credential ID makes each one verifiable.
- Harder: depends on Canva's integration approval and rate limits; our stored copy must be made before the 24-hour download link expires.
- Revisit: add a LinkedIn organization ID field per tenant if creators have LinkedIn pages.

## Open question

The "indicated size" of the frame (file types, dimensions or aspect ratio, maximum file size) is defined by the owner. Until then the validator takes these values from configuration.

## Action Items

1. [ ] Owner defines the frame rules (types, dimensions or aspect ratio, maximum bytes).
2. [ ] Register a Canva integration and confirm approval requirements for use by other creators.
3. [ ] Phase 11: tests for the URL builder (encoding, organizationId vs organizationName) and for the validator.

## Sources

- Canva export job endpoint: https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/
- LinkedIn add-to-profile builder reference: https://addtoprofile.linkedin.com
