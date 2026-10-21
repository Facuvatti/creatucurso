# ADR-0028: Each academy sends from its own Gmail (Gmail API, OAuth)

**Status:** Accepted
**Date:** 2026-10-20
**Supersedes:** ADR-0027 (Amazon SES); ADR-0016 (Resend) stays superseded

## Context
The owner does not want to pay for SES and wants emails to come from the academy itself. `docs/mails.md` (the old SES design) is kept only as history.

## Decision
- **Per-academy Gmail.** An owner or admin presses "Conectar mi Gmail" in the automations panel. OAuth 2.0 authorization code with PKCE (S256) and a signed single-use state, copied from the Mercado Pago connection (ADR-0023). Automation emails go out through `users.messages.send` (`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, `{raw: base64url RFC 5322}`) with `From: "<Academy name>" <their gmail>`, the same address in `Reply-To`, `List-Unsubscribe` and `List-Unsubscribe-Post`. Attachments are MIME parts; messages above 3 MB use the media upload endpoint. The raw MIME builder from the SES work is reused.
- **Scopes:** `https://www.googleapis.com/auth/gmail.send openid email`. Nothing that reads the mailbox. `email` gives the sender address (ID token claim from Google's token endpoint, over TLS). `access_type=offline` and `prompt=consent` so a refresh token is always returned.
- **Same OAuth client** as "Sign in with Google" (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), with one more authorized redirect URI: `<app origin>/api/gmail/callback`.
- **Tokens** (access, refresh) are encrypted with the secret box in `automations.gmail_connection` (`owner_key` = organization id, or `platform`). The access token (about 1 hour) is refreshed just before use and once on a 401. `invalid_grant` (revoked, expired) sets `disconnected`, deletes the tokens and shows a Spanish notice with the connect button. Network errors, 5xx and rate limits keep the connection (`error` or `connected`) and retry later. Disconnecting calls Google's revoke endpoint (best effort) and deletes the tokens. Tokens, codes, verifiers and response bodies are never logged.
- **Not connected:** deliveries wait as `pending` and are marked `skipped` (`gmail-not-connected`) after 3 days; the page shows a banner. "Enviarme una prueba" needs the connection.
- **Limits:** per academy `GMAIL_DAILY_LIMIT` (default 400) per rolling 24 h and 100 per hour, plus the 5/day per recipient. Gmail itself allows about 500 a day for personal accounts and 2000 for Google Workspace. 403 `rateLimitExceeded` / `userRateLimitExceeded` and 429 retry later with backoff and never disconnect.
- **Platform email** (verification, reset, alerts) uses the same mechanism with `owner_key = 'platform'`, connected by the user whose email is `PLATFORM_ADMIN_EMAIL` at `/admin/correo`. If the platform Gmail is missing or fails, the message goes to the console (production prints only the subject), the failure is reported once, and sign-up and reset never block. Register the admin account before opening sign-ups: the check is on the email, and email verification is not required.
- **Code:** `src/areas/automations/gmail.ts` (OAuth, tokens, send), `sendTenantEmail` / `sendPlatformEmail` in `src/server/email.server.ts`. There is no sender interface: one real sender and a console fallback.

## Consequences
- **No bounce or complaint feedback.** Reading the mailbox for bounces needs a restricted Gmail scope, which we do not request. Hard bounces and complaints are invisible to us: no suppression list and no automatic pause. Unsubscribes (per recipient, per academy) stay. The `automations.sending`, `automations.suppression` and `provider_event` objects of ADR-0027 are dropped.
- **Google verification.** `gmail.send` is a sensitive scope. In production the OAuth app must be verified (privacy policy, authorized domain, homepage, scope justification, demo video). Until then it can run in Testing with up to 100 test users, shows the "unverified app" warning, and refresh tokens of apps in Testing status expire after 7 days, so connections drop weekly.
- Mails sent by an academy appear in that academy's Gmail Sent folder and count against its quota. A personal Gmail may be restricted by Google if it sends mass mail; the default cap keeps a margin.
- A Gmail account that is disconnected stops that academy's mail until it reconnects; deliveries wait up to 3 days.
- Everything against real Google is unverified until credentials exist; behavior was checked with a local mock of its endpoints.
