# ADR-0015: Mercado Pago is integrated directly, not through Hyperswitch

**Status:** Superseded by ADR-0023 (Marketplace with OAuth)
**Date:** 2026-10-20
**Deciders:** Facu

## Context

ADR-0003 planned to reach Mercado Pago as a Hyperswitch connector, with each creator using their own credentials. In the Hyperswitch release we pin, Mercado Pago is not an available connector. Most of our creators sell in Argentina, where Mercado Pago is the payment method students expect.

## Decision

Mercado Pago is a **direct provider** next to Hyperswitch. Each academy has one provider (`payments.merchant.provider`: `hyperswitch` or `mercadopago`) and every payment records the provider that charged it.

- Checkout Pro: we create a preference with the creator's own access token and send the student to Mercado Pago. `external_reference` is our payment id.
- Money goes straight to the creator's Mercado Pago account. The platform takes no commission and holds no funds (same as ADR-0003).
- Webhooks are verified with the creator's webhook secret (`x-signature`), and then we **always re-fetch** the payment or chargeback from the Mercado Pago API and trust only that response.
- Refunds use `POST /v1/payments/{id}/refunds`. Chargebacks arrive as the `topic_chargebacks_wh` topic.
- Credentials are encrypted with the existing secret box and never sent back to the browser.

## Consequences

- Two code paths (Hyperswitch and Mercado Pago) share the same payment, refund, dispute and enrollment logic; only the calls to the provider differ.
- The Mercado Pago base URL lives in one constant (`src/areas/payments/mercadopago.ts`).
- If Hyperswitch adds a Mercado Pago connector, we can drop the direct path then. We do not abstract providers behind an interface now (ADR-0014).
- A creator who switches provider can no longer refund old payments from the app; they refund them in the old provider.
