# ADR-0009: Exam grading by creator webhook instead of uploaded scripts

**Status:** Accepted (owner decision)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Creators want exams graded by custom logic beyond form questions. The first idea was to let creators upload a script that evaluates a submission and returns a result in a fixed format. That means running untrusted code (the creator's script and the student's submission) on our servers, which requires strong isolation (no network, CPU/memory/time limits, protection against a submission forging the result) on a self-hosted ARM server with no hypervisor guarantees.

## Decision

The creator registers an **HTTPS webhook** on their own server. When a student submits, our server POSTs the submission to that URL and the creator's server returns the result in a documented format. **No creator or student code runs on our infrastructure**, so no sandbox is needed.

Contracts (documented in the dashboard with examples):
- **Request:** JSON with `exam_id`, `attempt_id`, an opaque `student_id`, `submitted_at` and the `answers`/`payload`; headers `X-Timestamp`, `X-Signature` (HMAC-SHA256 of timestamp and body with a per-exam secret) and `Idempotency-Key` (the attempt id).
- **Response:** JSON `{ "passed": boolean, "score": number (optional, 0 to 100), "feedback": string (optional, length-limited) }`.
- Any other outcome (wrong shape, timeout, non-2xx status, redirect, oversized body) is a **grading error and never a pass**.

Because we now make outbound requests to URLs chosen by creators, the main new risk is **SSRF**, handled by: HTTPS only on port 443; DNS resolution with blocking of loopback, private, link-local and cloud-metadata ranges (IPv4 and IPv6), connecting to the validated address; no redirect following; timeouts and a response size cap; no cookies or ambient credentials; and outbound traffic leaving through a restricted network or proxy that cannot reach internal services.

## Options Considered

### Option A: Webhook (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low to medium |
| Cost | Low |
| Scalability | Good (the creator's server does the work) |
| Team familiarity | High |

**Pros:** no untrusted code execution; creators can use any language and their own data; simple to meter and rate-limit.
**Cons:** creators need a server that can answer; SSRF must be handled carefully; grading latency depends on the creator's server.

### Option B: Sandboxed scripts
**Pros:** creators need no server.
**Cons:** requires a secure sandbox (several unresolved options on ARM), a threat model for two untrusted code sources, and ongoing operation of the runner.

## Consequences

- Easier: no sandbox research or runner service; the earlier optional research phase is removed from the plan.
- Harder: outbound request hardening and good documentation of the contracts; a creator whose endpoint is down cannot grade attempts, so the attempt is marked "grading failed" and can be retried.
- Revisit: sandboxed scripts only if many creators cannot run a server.

## Action Items

1. [ ] Phase 5c: SSRF guard module with tests for private, loopback, link-local, metadata and redirect cases, including IPv6 and DNS that resolves to a private address.
2. [ ] Phase 5c: signature scheme tests (valid, wrong secret, replayed timestamp).
3. [ ] Phase 5c: public documentation page with request and response examples and a test-payload button.
