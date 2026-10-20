# ADR-0016: Transactional email through Resend

**Status:** Superseded by ADR-0027 (Amazon SES)
**Date:** 2026-10-20

## Context
The app must send email verification and password reset messages (Phase 2), and later automation emails (Phase 12). Deliverability matters: a reset email in spam is a support ticket.

## Decision
Use Resend as the default transactional provider, called with a plain `fetch` to `https://api.resend.com/emails` (no SDK). The whole integration is one function, `sendEmail({ to, subject, text, html })` in `src/server/email.server.ts`. It reads `RESEND_API_KEY` and `EMAIL_FROM` directly. When `RESEND_API_KEY` is empty it prints the message, including the link, to the console, so development needs no account.

Email verification is sent on sign-up but `requireEmailVerification` stays off, so login keeps working before a provider is configured. Revisit when Resend is live in production.

## Options considered
- **Self-hosted mail (Postfix and friends):** rejected. A fresh IP on a Raspberry-class host has no reputation, residential ranges are often blocked, and SPF/DKIM/DMARC/rDNS upkeep is a recurring cost for one maintainer.
- **Resend (chosen):** simple HTTP API, free tier enough for launch, DKIM handled once per domain.
- **SES, Postmark, Brevo:** equally valid; not chosen only for setup simplicity.

## Consequences
- Swapping provider means editing only `sendEmail`; callers do not change.
- A failed send is logged and never blocks sign-up or the reset request.
- Phase 12 may add attachments and per-tenant sender domains; that extends `sendEmail`, still one function.
- Fallback if Resend is unavailable: any provider with an HTTP API replaces the body of `sendEmail`.
