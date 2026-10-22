# ADR-0023: Mercado Pago as a Marketplace with OAuth

**Status:** Accepted (supersedes ADR-0015)
**Date:** 2026-10-20
**Deciders:** Facu

## Context

ADR-0015 made each creator paste their own access token and webhook secret. That asks every creator to create a Mercado Pago application, configure notifications and copy secrets, and we can never renew or detect the revocation of those tokens.

## Decision

The platform owns **one Mercado Pago application** (env `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`) and each academy links its seller account with OAuth (authorization code + PKCE S256).

- **Connect:** the owner or an admin clicks "Conectar Mercado Pago". The server creates a PKCE verifier and a signed state (HMAC-SHA256 over organization, user, nonce and expiry, 10 minutes; the key is derived from `SECRETS_ENCRYPTION_KEY`), stores a single-use row in `payments.mercadopago_oauth_state` (state hash, encrypted verifier, return origin) and sends the browser to Mercado Pago.
- **Callback:** one fixed route on the central host, `${appOrigin()}/api/mercadopago/callback`. It verifies the signature and expiry, deletes the stored row (single use), checks that the logged-in user is the one who started it and is still owner or admin, exchanges the code, and stores per academy in `payments.mercadopago_connection` the access and refresh token (encrypted with the secret box), public key, seller user id, expiry and status. It then returns to the academy's `/panel/pagos` with a flash code.
- **Tokens:** an access token lasts 180 days and the refresh token rotates. The worker renews hourly the tokens that expire within 30 days (row lock, both tokens stored in one transaction). Before use, a token expiring within 5 minutes is renewed; a 401 renews once and retries once.
- **Status:** `connected`, `error` (transient refresh failure, retried on the next run) or `disconnected` (refresh rejected, 403 or a second 401 on use, the `mp-connect` deauthorization, or "Desconectar"). A disconnected academy cannot charge: checkout answers with a clean message and free enrollments are untouched. Mercado Pago documents no token revocation call, so "Desconectar" only deletes our tokens and the panel tells the creator to revoke the app in their Mercado Pago account.
- **One webhook:** `POST /api/webhooks/mercadopago`, verified with `MP_WEBHOOK_SECRET`. The seller `user_id` in the notification body maps to the academy through `mercadopago_connection.mp_user_id`. As before, we trust only what the API returns, fetched with the academy's token.
- **Fee:** the preference field is `marketplace_fee`, an **amount** in the preference currency (not a percent), omitted when 0. The platform collects its commission at sale time through this field: the amount is the selling academy's plan commission on the sale (ADR-0029, "Commission at sale"), computed in `billing.ts`, not a global percent env. The old `MP_MARKETPLACE_FEE_PERCENT` is gone. Mercado Pago reverses this fee proportionally on a refund.
- **Logs:** `MercadoPagoError` carries only the HTTP status and Mercado Pago's error code. Response bodies, payment data and secrets are never logged.
- **Transition:** academies with pasted credentials (`payments.merchant`, provider `mercadopago`) keep working through the old per-academy route `/api/webhooks/mercadopago/<organizationId>`, marked `LEGACY: remove after migration`. Completing OAuth deletes that row in the same transaction. New pasted credentials are no longer accepted.

## Consequences

- Creators click once instead of configuring an application, and we can renew tokens and notice revoked access.
- The platform holds one application secret and the tokens of every academy, so `SECRETS_ENCRYPTION_KEY` matters more.
- A Mercado Pago account can be linked to only one academy at a time.
- Hyperswitch stays as the other provider (an academy has one provider; connecting one replaces the other).
- `MP_AUTH_URL` and `MP_API_URL` exist only to run against a local mock.
