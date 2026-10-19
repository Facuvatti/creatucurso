# ADR-0003: Hyperswitch merchant model for creator payments

**Status:** Accepted (business decision confirmed; connector checks remain in Phase 4)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Students pay creators for courses through a self-hosted Hyperswitch. We must decide how creators map to Hyperswitch accounts and whether the platform splits payments.

Verified in the Hyperswitch documentation:
- Hierarchy is Organisation, then Merchant, then Profile.
- The "pick the right setup" guide recommends "Platform Organization with Standard Merchants" (or a Standard Organization) when each sub-merchant must stay fully isolated, and "Platform Organization with Connected Merchants" for marketplaces that need a shared customer view.
- Self-hosting runs through Docker Compose; a merchant is created with `POST /accounts` using the admin API key.
- Split payments are documented only for Stripe (`transfer_account_id`, `application_fees`) and Adyen (`split_items`). Payout processors exist (for example EBANX for Latin America).
- The connector list of the connector-service (Prism) specification includes `MERCADOPAGO`, `DLOCAL` and `EBANX`.

Not verified: that the connectors we need are enabled in the self-hosted router (the list above comes from the connector-service spec), and whether the open-source router offers the Platform Organization type.

## Decision

Each creator is an **isolated Hyperswitch merchant with one business profile**, configured with the creator's **own payment connector credentials** (for example their own Mercado Pago account). Students' payments settle directly to the creator. The platform does not split payments and does not hold creator funds.

The platform earns through its own usage-based invoices to creators (Phase 8), collected through a separate platform merchant in the same Hyperswitch.

`organization.hyperswitchMerchantId` and `hyperswitchProfileId` store the mapping. The merchant is created when the creator organization is created, and the creator connects their connector from the dashboard.

## Options Considered

### Option A: One merchant per creator, creator's own connector credentials (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low to medium |
| Cost | Low |
| Scalability | Good |
| Team familiarity | Medium |

**Pros:** works with any connector, including those without documented split support; the platform never holds creator money (less regulatory and reconciliation burden); full isolation of data per creator.
**Cons:** the platform cannot take an automatic commission on each sale; each creator needs their own account at a payment provider.

### Option B: Platform collects, then pays creators out
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | High |
| Scalability | Medium |
| Team familiarity | Low |

**Pros:** automatic commission; creators need no provider account.
**Cons:** the platform becomes responsible for holding and disbursing funds (compliance, refunds, chargebacks, taxes); requires a payout processor in the target market.

### Option C: Native split payments through a connector
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Medium |
| Scalability | Good |
| Team familiarity | Low |

**Pros:** automatic commission without holding funds.
**Cons:** documented only for Stripe and Adyen; ties the platform to those connectors and to creators onboarding as connected accounts there.

## Trade-off Analysis

The plan already bills creators for infrastructure usage (Phase 8), so Option A is consistent with the business model and is the lowest-risk path. Options B and C are only needed if the platform wants a commission on sales.

## Consequences

- Easier: payments, refunds and chargebacks stay between the student and the creator's provider; connector availability depends only on what Hyperswitch supports for the creator's market.
- Harder: creators must connect their own provider account before selling; platform revenue depends on the usage invoices being collected.
- Revisit: Option C if the platform decides to charge a commission on sales and the market's connector supports splits.

## Business decision (resolved)

Creators are billed monthly by the platform; there is no commission on sales. This confirms the usage-based invoices of Phase 8 as the platform's revenue and removes the need for splits or payouts. If a flat monthly fee is added on top of usage, that changes the invoice amount only, not this model.

## Action Items

1. [ ] Phase 4: bring up Hyperswitch locally with Docker Compose and confirm the target market's connector (for example Mercado Pago) can be enabled in the self-hosted router.
2. [ ] Phase 4: confirm whether the open-source router supports the Platform Organization type; otherwise use a Standard Organization.
3. [ ] Phase 4: verify webhook signature validation for the chosen connector.
