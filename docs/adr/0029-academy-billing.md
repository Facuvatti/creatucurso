# ADR-0029: Academy billing (free trial, plans and Mercado Pago subscription)

**Status:** Accepted (owner decisions 2026-10-21/22)
**Date:** 2026-10-22
**Deciders:** Facu

## Context

Release 3, Phase 8. Each academy is a tenant (better-auth Organization). We need
a free trial, a way to bill the academies monthly, and a way to charge them
automatically. Mercado Pago is already integrated for the academies' own sales
as a marketplace with OAuth (ADR-0023); those connected accounts are the
academies' money, not ours. Billing is a separate concern: the academy pays the
PLATFORM.

## Decisions

### Free trial

- 30 days from the creation of the academy. During the trial an academy can have
  at most **10 students** (distinct members with role `student` and an active
  enrollment). The limit is enforced on the server in every enrollment path:
  free enrollment, paid checkout (before the payment is created) and manual
  enrollment by email. A single gate, `enrollmentBlock(organizationId, userId)`
  in `src/areas/billing/billing.ts`, is used by all three. A person already
  enrolled, and staff, never take a new place.
- The creator sees a clear Spanish message; a buyer sees "Esta academia no puede
  sumar alumnos en este momento." Paid checkout refuses before creating the
  payment, so no money moves.
- Academies that existed before billing start their trial on the deploy date,
  env `BILLING_TRIAL_START` (default `2026-10-21`), not their creation date.

### Plans (owner file `docs/planes_suscripcion.md`)

All features are in every plan (no gating). Plans change only the price. Monthly,
per published course. The payment gateway's own ~2% is charged by the gateway to
the academy, apart from these amounts (to be stated in the T&C, R7). The plans,
in `src/areas/billing/billing.ts` (`PLANS`), amounts in ARS:

| Plan | Monthly fee | Platform commission | Minimum commission |
|---|---|---|---|
| `commission` (Solo Comisión) | $0 | 35% per sale | $5.000 per sale |
| `hybrid` (Híbrido) | $5.000 per course | 5% per sale | $1.000 per sale |
| `flat` (Flat por Curso) | $10.000 per course | 0% | — |

- Flat bundle: every 3 courses cost $25.000 instead of $30.000.
- The minimum is a minimum of **platform commission per sale**, never more than
  the sale itself (a $300 sale on commission pays $300, not $5.000).
- Commission is computed on the amount paid net of refunds, over sales in ARS in
  the billed days. Sales in another currency are listed in the invoice details
  but not charged (no FX conversion yet).
- Default plan (no choice) is `commission` (no fixed fee: the one the owner says
  is for whoever is starting out).
- A plan change takes effect from the 1st of the next month, so a month is billed
  under one plan; during the trial it applies immediately. Stored per effective
  date in `billing.academy_plan`.

### Usage metering

- Daily worker job writes `billing.tenant_usage(organization_id, day, storage_bytes,
  stream_bytes, plays, seconds_watched, provider_cost, unit_prices)`, unique per
  (organization_id, day), from `media.playback_usage` and the stored video bytes.
  Idempotent per day (upsert: stream numbers recomputed, storage snapshot of the
  first run kept). The last three complete days are re-run so a worker that was
  down catches up.
- `provider_cost` is what the day cost the PLATFORM (storage per day of the month
  plus streamed bytes), priced with env `BILLING_PRICE_PER_GB_STREAM` and
  `BILLING_PRICE_PER_GB_STORAGE_MONTH`. It is informative (the owner's numbers and
  a panel estimate); it is **not** what the academy is charged — the plans are.
  Premium (DRM, Bunny/VdoCipher) usage is added here in R7; a comment marks it.

### Monthly close

- On the 1st (the hourly worker job; idempotent, so it lands once that day) for
  each academy out of trial: `billing.invoice(id, organization_id, period 'YYYY-MM',
  amount, currency, status draft/open/paid/failed/void, details jsonb, created_at,
  failed_at, paid_at)`, unique per (organization_id, period). Only the days after
  the trial are billed, prorating the monthly fee. Amount = plan fee (prorated) +
  commission of the month's sales. Zero-amount invoices are born `paid`.

### Monthly subscription (variable amount) — the decision and its evidence

The academy authorizes one Mercado Pago **subscription (preapproval without a
plan)** of the PLATFORM's own Mercado Pago account (env `MP_PLATFORM_ACCESS_TOKEN`),
not an academy's connected marketplace account.

Variable amount: **we update the amount of the existing preapproval before each
charge** rather than a fixed plan plus a separate charge. Evidence from the
official docs (verified 2026-10-22):

- Create a preapproval without a plan: `POST /preapproval` with `reason`,
  `external_reference`, `payer_email`, `auto_recurring {frequency, frequency_type,
  transaction_amount, currency_id}`, `back_url`, `status: "pending"`. The response
  carries `id`, `status` and `init_point` (where the payer authorizes it). Source:
  developers.mercadopago, "Suscripciones sin plan asociado / pagos pendientes".
- Change the amount: `PUT /preapproval/{id}` with
  `{auto_recurring: {transaction_amount, currency_id}}`. Also pause/resume/cancel
  with `{status: "paused"|"authorized"|"cancelled"}`. Source: "Gestión de
  suscripciones" and the API reference `PUT /preapproval/{id}`.
- Recurring charges ("authorized payments"): on a rejection Mercado Pago retries
  up to 4 times within 10 days; after 3 consecutive failed charges it cancels the
  subscription and notifies the seller. Source: "Suscripciones con pago autorizado".
- Webhook topics: `subscription_preapproval` (the subscription created/updated)
  and `subscription_authorized_payment` (a recurring charge). Signed with the
  application's secret like the existing MP webhooks (`ts`/`v1`, HMAC-SHA256 over
  `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`). Re-fetch from the API with
  the platform token: `GET /preapproval/{id}`, `GET /authorized_payments/{id}`.

How a variable amount is charged here:
- `billing.subscription(organization_id pk, mp_preapproval_id, status, payer_email,
  lapsed_at, charge_amount, ...)`. We keep the preapproval's amount equal to what
  the academy owes (sum of open + failed invoices) and **pause** it while nothing
  is owed, so each monthly charge takes exactly the last close (`syncSubscription`).
  When a new invoice is written the worker resumes it with the new amount
  (`syncPendingSubscriptions`). First charge: with a debt already owed, right away
  (no `start_date`); otherwise it starts on the 2nd of the month after the trial.
- The webhook (`POST /api/webhooks/mercadopago-billing`) never trusts the body: it
  verifies the signature (env `MP_PLATFORM_WEBHOOK_SECRET`) and re-fetches the
  preapproval or the authorized payment with the platform token. An approved charge
  pays the oldest unpaid invoices it covers, once (`billing.subscription_charge`
  with `applied_at` makes a replay safe). A rejected/recycling charge marks the
  open invoices `failed`.

### Dunning and suspension

- A failed or missing payment sets `failed_at` on the invoice; the state machine
  (`academyBillingState`, short in-memory cache) turns the academy `past_due` from
  the earliest failed invoice (or the trial end with no usable subscription, or a
  cancelled subscription) and `suspended` after a grace period
  (env `BILLING_GRACE_DAYS`, default 10). An open invoice nobody charged becomes
  `failed` after 35 days.
- Spanish banner in the panel (and the tenant layout) and an email to the owner
  through `sendPlatformEmail`, queued once per unpaid episode through the outbox
  (dedupe key holds the episode start). Mercado Pago does its own retries.
- Suspended: the public site and the panel show a clear Spanish notice (nothing is
  deleted). New enrollments and checkouts are refused. **Students keep studying;
  the academy cannot sell or add students** (the simplest fair rule). Playback is
  untouched — only the enrollment paths gate.
- Trial end without an active subscription follows the same flow (past_due →
  suspended after grace).

### The gate

`academyBillingState(organizationId)` is the one function; a 30-second cache keeps
it cheap. Used by the enrollment paths, checkout, the panel and the tenant layout.

## Consequences

- One preapproval per academy whose amount we steer; we never hold the academies'
  card data (Mercado Pago does).
- The platform needs its own Mercado Pago subscriptions application
  (`MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_WEBHOOK_SECRET`), separate from the
  marketplace application of ADR-0023.
- Verified against a local mock only, never against real Mercado Pago (no platform
  credentials yet). Unverified: the exact shape of the authorized-payment resource,
  the precise statuses Mercado Pago sends, and that pausing/resuming a preapproval
  behaves as assumed between charges.
- The 10-student trial limit must appear in the T&C (R7), and so must the ~2%
  gateway fee charged apart from the plans.

## Commission at sale (owner decision 2026-10-22)

The platform commission is **collected at sale time**, not billed in the monthly
invoice. When a course sale creates a Mercado Pago Checkout Pro preference, the
`marketplace_fee` is set to the selling academy's current plan commission on the
sale amount (`commissionOf(plan, amount)` in `billing.ts`: the plan rate, the
minimum per sale, capped at the sale). Mercado Pago sends that amount to the
platform's marketplace application automatically (the OAuth marketplace split,
ADR-0023). The amount charged is stored on the sale in
`payments.payment.commission_amount`. The flat plan (0%) and the legacy /
Hyperswitch path send no fee (Hyperswitch cannot split here; commission for
legacy academies is out of scope).

- **Monthly invoice:** `chargesFor`/`closeMonth` now bill ONLY the fixed monthly
  per-course fee of the plan (plus the flat 3-course bundle at $25.000). The
  commission is no longer added to the invoice amount; it is kept in the invoice
  `details` and the panel estimate for reference only. Usage metering is
  unchanged (still recorded for the owner's numbers).
- **Refunds:** verified against the official Mercado Pago split-payments docs
  (2026-10-22, "Integrate marketplace"): *"In case of a refund, the amount due to
  the final customer will be divided and subtracted from the seller's account and
  the Marketplace's account, in a proportional way to the parties involved."*
  So a full or partial refund of a payment that carried a `marketplace_fee`
  **reverses the fee automatically and proportionally** — no extra parameter on
  `POST /v1/payments/{id}/refunds`. The platform keeps no commission on refunded
  money. `commission_amount` is left as the historical as-charged figure (the
  effective commission after a refund is that amount prorated by the unrefunded
  share). Note the 1:1-model limitation: a marketplace cannot fully refund if the
  seller lacks funds; it refunds its own share and the seller's share may need
  another means.
