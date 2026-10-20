# ADR-0026: Email automations

**Status:** Accepted
**Date:** 2026-10-20

## Context
Creators want an email when a student enrolls or finishes a course (Phase 12, email only). `docs/mails.md` also asks for per-tenant reputation isolation, suppression and automatic pause.

## Decision
- **Outbox consumer.** The worker calls `runAutomations(event)` for `enrollment.created` and, after the certificate is issued, `course.completed`. It inserts one `automations.message_delivery` row per enabled automation of the course's own academy (course null = all courses) and sends through `sendEmail` (no channel interface; ADR-0016).
- **Idempotency.** `unique (event_id, automation_id)` where `event_id` is the outbox id: a replayed event creates nothing. A failing email is retried on its own delivery row (backoff 1, 2, 4, 8 min, five attempts, then `failed` with an error code, never a provider body). The worker also sweeps due deliveries every 30 s, so one failing email never fails the outbox event or blocks the other automations.
- **Unsubscribe.** Every message carries a footer link, `List-Unsubscribe` and `List-Unsubscribe-Post`. The link is `/baja/<token>` on the academy host; the token is an HMAC (key derived from `SECRETS_ENCRYPTION_KEY`) over academy and email. GET shows a confirmation button, POST records it (so link scanners do not unsubscribe anyone). Unsubscribes are per academy (`email_unsubscribe`); those recipients are `skipped`.
- **Limits.** Per academy 200 emails/hour and 2000/day (`sending.daily_limit` overrides the day cap): over the cap the delivery stays pending and is retried. Per recipient 5/day per academy (`skipped`). Attachments: 5 files, 10 MB each, 15 MB total; PDF, PNG, JPEG, ZIP, DOCX, XLSX, TXT with magic-byte checks; stored under `MEDIA_ROOT/automations/<org>/<automation>/`, never served.
- **docs/mails.md (SES), what is built.** Per-academy `sending` row (status, daily limit), global `suppression` list, sending skipped when paused or suppressed, a signed SNS webhook `POST /api/webhooks/ses` (verifies Amazon's signature, confirms subscriptions, idempotent updates, permanent bounces and complaints suppress the address) and automatic pause when, over 7 days with at least 100 sent, hard bounces exceed `EMAIL_MAX_BOUNCE_RATE` (5%) or complaints `EMAIL_MAX_COMPLAINT_RATE` (0.1%). Rates come from the delivery log. The admin is alerted through the error tracker; resuming is manual: `update automations.sending set status = 'active' where organization_id = '...'`.

## Not built
- Sending through SES itself: per-academy configuration sets and event destinations, `EmailTags`, an `EmailSender` interface, and AWS credentials. Sending stays on Resend (ADR-0016); moving to SES means rewriting `sendEmail` and creating the configuration set when an academy is created (`provider_message_id` already maps events to deliveries). The AWS production-access request (sandbox exit) is a pending manual step.
- WhatsApp and Discord (ADR-0007): out of scope, no channel abstraction until a second channel exists.
- Transactional emails (verification, reset) are untouched and ignore unsubscribes.
