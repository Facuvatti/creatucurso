# Mercado Pago (direct integration)

See ADR-0015. Code: `src/areas/payments/mercadopago.ts` (API calls, signature) and
`src/areas/payments/payments.ts` (checkout, webhook, refunds). Webhook route:
`/api/webhooks/mercadopago/<organizationId>`.

**Status: written against the official documentation but never run against Mercado Pago.**
The checks below are what the owner must do.

## How to test

1. Create a **test seller** user (Mercado Pago Developers > Your integrations > Test accounts)
   and a **test buyer** user. Use the seller's credentials, never your real ones.
2. In the seller's developer panel create an application (Checkout Pro). Copy its **TEST access token**
   (`TEST-...`).
3. Make the app reachable from the internet while testing locally (the webhook is called by Mercado Pago):
   `cloudflared tunnel --url http://localhost:4310` (or ngrok). Set in `.env`
   `MERCADOPAGO_WEBHOOK_BASE_URL=https://<your-tunnel-host>` and restart the app.
   Also set `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`).
4. In the application: Webhooks > Configure notifications > test mode, URL
   `https://<tunnel>/api/webhooks/mercadopago/<organizationId>` (Panel > Cobros shows the exact URL).
   Enable events **Pagos** and **Contracargos** (`topic_chargebacks_wh`). Copy the **secret signature**.
5. Panel > Cobros > Mercado Pago: paste the access token and the secret signature, save.
   The app calls `GET /users/me` to validate the token.
6. Put a price on a course and buy it as another user (log in on the tenant subdomain). Pay with a test card
   (https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards)
   as the test buyer.

## What to check

- Redirect to Mercado Pago works; coming back to `/cursos/<slug>/compra` shows "Pago confirmado" and the
  student is enrolled exactly once (the webhook and the page poll both fire).
- Webhook with a wrong secret answers 401; with the right one answers 200 (check `x-signature` handling:
  manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 hex). If it always answers 401,
  log the incoming `x-signature`, `x-request-id` and `data.id` first: that is the likeliest thing to be off.
- Panel > Cobros: full refund and partial refund (amount) work; full refund removes access; partial does not.
  A refund done from the Mercado Pago dashboard also arrives (via the payment's `refunds` list).
- Student "Solicitar reembolso" on the course page: visible only within 10 days and under 10% completed.
- Chargebacks (hard to test; Mercado Pago has no simulator that I know of): unverified assumptions
  - The chargeback is fetched with `GET /v1/chargebacks/{id}` and header `X-Caller-Id` = seller id.
  - `coverage_applied === true` means the seller won; a payment in status `charged_back` means lost;
    anything else is treated as "open" (suspends access). Confirm field names against a real case.
  - The `data.id` in the signed manifest may differ for chargeback notifications.
- `events.outbox` has rows for `enrollment.created`, `enrollment.refunded`, `dispute.*`; `pnpm worker`
  marks them delivered (`curl localhost:3101/health`).

## Notes

- Amounts: the app stores minor units (cents); Mercado Pago receives/returns major units (divided/multiplied by 100).
- The webhook body is never trusted: every notification triggers `GET /v1/payments/{id}`.
- Switching provider in Panel > Cobros replaces the credentials; old payments of the other provider
  cannot be refunded from the app.
