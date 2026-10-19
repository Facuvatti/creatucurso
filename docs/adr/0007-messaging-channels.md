# ADR-0007: Messaging channels for tenant automations (email, Discord, WhatsApp)

**Status:** Proposed. Scope update: only email is in v1; the owner deferred WhatsApp and Discord, and will provide `docs/mails.md` with the email requirements (read it when the automations phase starts).
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Tenants configure automations that send a message, optionally with attachments, when a student enrolls or finishes a course. The tenant picks the channel: email, Discord or WhatsApp.

Findings from public documentation and search results (confirm against the official pages at implementation time):
- **WhatsApp Business Platform (Cloud API):** business-initiated messages outside the 24-hour customer-service window must use pre-approved templates and need the user's prior consent; billing is per template message, by category and country. Documented media limits found: images 5 MB (png, jpeg), audio and video 16 MB, documents 100 MB (pdf and office formats). Whether arbitrary attachments are allowed inside template messages was not confirmed.
- **Discord:** a bot can DM a user only if they share a server and the user allows direct messages from server members; otherwise the API returns error 50007 ("Cannot send messages to this user").
- **Email:** no research done; deliverability depends on sender-domain setup (SPF, DKIM, DMARC) and on the sending provider.

## Decision

All channels sit behind one `MessageChannel` adapter interface, and nothing is sent without a recorded opt-in for that channel.

- **Email:** use a transactional email provider (to be chosen). Messages go out from a platform domain with the tenant's name as the display name. Sending from a tenant's own domain is optional and requires that tenant's DNS records.
- **Discord:** the primary mode posts to a channel in the tenant's Discord server through a bot, after the student links their Discord account and joins that server. A direct message is a best-effort extra; error 50007 is recorded as "undeliverable" and not retried.
- **WhatsApp:** use the Cloud API with pre-approved templates and explicit student opt-in. The WhatsApp business account belongs to the **tenant** (their number, their template approvals, Meta bills them), mirroring the payments model of ADR-0003. Message counts are still recorded for metering.
- **Attachments:** validated against each channel's limits at upload time. When a channel cannot carry the file, the message includes an expiring signed link instead. Per-tenant channel credentials are stored encrypted on the server only.

## Options Considered

### WhatsApp account ownership
- **Tenant-owned (chosen):** the tenant's brand and costs; a misbehaving tenant cannot damage the platform's sender reputation; requires each tenant to set up an account.
- **Platform-owned:** simpler for tenants, but the platform pays Meta, re-bills tenants, and shares one quality rating across all tenants.

### Discord delivery
- **Channel posts (chosen) vs. DMs only:** DMs depend on the recipient's privacy settings and on a shared server, so they fail often; channel posts are reliable but public to the server members.

## Consequences

- Easier: consistent consent handling and delivery logging across channels.
- Harder: tenants must complete WhatsApp business onboarding and template approval; students must link Discord.
- Revisit: platform-owned WhatsApp if tenant onboarding turns out to be a barrier.

## Action Items

1. [ ] Choose the email provider and define the sender-domain setup.
2. [ ] Confirm with Meta's documentation how attachments work inside templates and the current price per category for the target countries.
3. [ ] Define the Discord linking flow (OAuth identify scope) and the bot permissions needed to post to a channel.
4. [ ] Phase 12: opt-in storage per channel and an opt-out path.

## Sources

- WhatsApp Business Platform pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md
- WhatsApp media limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
- Discord direct messages and error 50007: https://www2.courier.com/docs/guides/providers/direct-message/discord
