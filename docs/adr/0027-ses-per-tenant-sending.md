# ADR-0027: Amazon SES sending, one configuration set per academy

**Status:** Superseded by ADR-0028 (Gmail API per tenant)
**Date:** 2026-10-20
**Supersedes:** ADR-0016 (Resend)

## Context
`docs/mails.md` asks for Amazon SES v2 with reputation isolation per tenant, tags, an SNS webhook, automatic pause and an `EmailSender` interface.

## Decision
- **SES v2** through `@aws-sdk/client-sesv2` (pure JS). `sendEmail` in `src/server/email.server.ts` is the single entry: SES when `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and a sender (`SES_FROM_EMAIL` or `EMAIL_FROM`) are set, otherwise a console sender (development). `EmailSender` is the one allowed interface, with exactly these two implementations. Resend is removed.
- **Raw MIME** (multipart/mixed, base64 attachments, RFC 2047 subject) only when an email has custom headers (`List-Unsubscribe`) or attachments; otherwise `Content.Simple`.
- **One configuration set per academy**, `tenant-<organizationId>` (a hash when the id is not a safe name), with reputation metrics on and an event destination (SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT) to the shared SNS topic. Created by `ensureTenantSending`: at academy creation (best effort), lazily before the first send, and by `scripts/provision-ses-tenants.ts` for existing academies. Automation emails carry the set and the tags `tenantId` and `courseId`. Verification and reset emails go out without a tenant set (optionally `SES_PLATFORM_CONFIGURATION_SET`).
- **Manual pause.** The existing rate check (7 days, at least 100 sent, 5% hard bounces or 0.1% complaints) now also calls `PutConfigurationSetSendingOptions(SendingEnabled=false)`, reports the error and emails `PLATFORM_ADMIN_EMAIL`. Resuming is admin-only: `scripts/resume-ses-tenant.ts <organizationId>` (there is no platform admin UI yet).
- **SES native tenants: not used.** They are documented and in SDK 3.1154 (`CreateTenant`, `CreateTenantResourceAssociation`, `TenantName` on `SendEmail`, reputation policies, pause via `UpdateReputationEntityCustomerManagedStatus`) and look supported, but they add a per-tenant monthly fee, require associating identities and sets per tenant, and use a second pause API; the manual scheme is simpler, free and uses calls we verified. Revisit if tenant-level reputation policies or tenant suppression lists become necessary.
- **Sandbox exit is pending** (see `docs/ses-setup.md`); until then SES only delivers to verified addresses.

## Consequences
- Everything real against AWS is unverified until credentials exist; behavior was checked only against a local mock.
- Hard bounces and complaints suppress the address globally; the counters come from the delivery log.
