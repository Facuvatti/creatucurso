# Mercado Pago (marketplace with OAuth)

See ADR-0023. Code: `src/areas/payments/mercadopago.ts` (API calls, signature),
`mercadopago-connection.ts` (OAuth, tokens, renewal), `payments.ts` (checkout, webhooks, refunds),
`src/routes/api/mercadopago/callback.ts` and `src/routes/api/webhooks/mercadopago.ts`.

**Status: verified against a local mock, never against real Mercado Pago.** The checklist below is what the
owner must do with test users.

## Platform setup (once)

1. Developer panel (Your integrations): create an application for Checkout Pro with **Marketplace / Split
   payments** and OAuth, with **PKCE** on. Scopes: `offline_access`, `read`, `write` (without `offline_access`
   there is no refresh token and a connection expires after 180 days).
2. **Redirect URL:** `<app origin>/api/mercadopago/callback`, for example `https://app.tudominio.com/api/mercadopago/callback`.
3. **Webhooks > Configure notifications:** URL `<base>/api/webhooks/mercadopago` (`<base>` is the app origin, or
   `MERCADOPAGO_WEBHOOK_BASE_URL` when the public URL differs, like a tunnel). Topics: **Pagos** (`payment`),
   **Contracargos** (`topic_chargebacks_wh`) and **Vinculación de aplicaciones** (`mp-connect`).
   The **secret signature** shown there is the webhook secret variable.
4. `.env` (see `.env.example`): the application id and secret from Credentials, the webhook secret,
   `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`), and optionally the fee percent, `MP_AUTH_URL`,
   `MP_API_URL` and `MERCADOPAGO_WEBHOOK_BASE_URL`. Restart the app and `pnpm worker` (the worker renews tokens).
5. Create **test users** (Test accounts): one **seller** and one **buyer**.

## How to test

1. Panel > Cobros > "Conectar Mercado Pago" as an academy owner; log in to Mercado Pago with the **test seller**
   and authorize. You return to the panel with "Mercado Pago conectado".
2. Put a price on a course and buy it as another user with the **test buyer** and a test card
   (https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards).
3. Check: redirect to Mercado Pago, coming back to `/cursos/<slug>/compra` shows "Pago confirmado", the student is
   enrolled exactly once (the webhook and the page poll both fire).

## What to check

- Webhook: wrong signature answers 401, unknown seller `user_id` answers 404 `no-merchant`, valid answers 200.
  Signature manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 hex. Parts absent from the
  notification (`data.id` on `mp-connect`) are left out. If it always answers 401, compare the manifest first.
- Refunds from Panel > Cobros: full and partial; a refund done in the Mercado Pago dashboard also arrives.
- Fee: with a fee percent of 10 the preference carries `marketplace_fee` (an amount, 10% of the price) and the
  platform account receives it on each sale.
- Revocation: revoke the app from the seller's Mercado Pago account. The `mp-connect` notification, or the next
  call (401), turns the panel to "Mercado Pago está desconectado" and checkout answers "Este curso no puede
  cobrarse en este momento".
- Renewal: tokens last 180 days. Move a connection's `expires_at` within 30 days, run `pnpm worker` and check that
  both tokens changed (Mercado Pago rotates the refresh token).
- "Desconectar" deletes our tokens. The documentation has no revocation call, so the creator also revokes the app
  in Mercado Pago.
- Unverified assumptions: the exact `action` of the `mp-connect` notification (we match `unlink` or `deauthori`;
  anything else is checked with a call to the API); chargeback fields (`coverage_applied`, header `X-Caller-Id`
  = seller id); that the authorization host `auth.mercadopago.com` is right for Argentina (docs) and not `.com.ar`.

## Data

- `payments.mercadopago_connection`: one row per academy (seller id, encrypted tokens, expiry, status, reason, attempts).
- `payments.mercadopago_oauth_state`: single-use rows of attempts in flight (encrypted PKCE verifier).
- Amounts: the app stores minor units; Mercado Pago receives and returns major units.
- The webhook body is never trusted: every notification triggers a `GET` with the academy's token.

## Legacy (remove after migration)

Academies that pasted credentials before ADR-0023 keep working with their own token and the per-academy route
`/api/webhooks/mercadopago/<organizationId>` (their own webhook secret). Their panel shows a banner and the
"Conectar Mercado Pago" button; completing OAuth deletes the pasted credentials. When no `payments.merchant` row
with provider `mercadopago` is left, delete the code marked `LEGACY`.
