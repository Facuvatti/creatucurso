# ADR-0034: Lessons with an embedded web app that reports a result

**Status:** Accepted
**Date:** 2026-10-23
**Deciders:** Facu

## Context

Creators want a lesson to be any web app they host (a quiz, a code editor, a simulation, a game). The platform only needs the evaluation result: a score, a pass / fail, or both. A passed lesson must complete the course the same way a watched video does, so certificates and automations keep working. Some results back a certificate, so they need a path the student cannot forge.

## Decision

1. **The lesson stores an app URL.** `catalog.lesson` gets `embed_url`, `embed_passing_score` (default 60) and `embed_verified_only`. The URL is validated on the server: `https:` only, no credentials, standard port, no IP literal or `localhost`, and not the platform domain or its subdomains. Courses can import it as `embed: { url, passingScore, verifiedOnly }`; a class needs at least one video or an embed.
2. **Open result contract.** A result has `score` and `maxScore` (default 100) and / or `passed`, plus optional `timeSpentSec` and `metadata` (JSON, 4 KB cap). At least one of `score` or `passed` is required. If `passed` is present it decides; otherwise the lesson passes when `score / maxScore * 100 >= passing score`. A passed result inserts lesson progress and runs `completeCourseIfDone`.
3. **Two reporting paths.** From the browser, the app includes `public/sdk/lesson-sdk.js` and calls `LessonSDK.complete`, which uses `postMessage` to the platform page (stored with `source = 'client'`, `verified = false`). From the app's backend, a POST to `/api/lessons/results` signed with HMAC-SHA256 stores `source = 'server'`, `verified = true`. A verified result is never replaced by a client one. "Exigir resultado verificado" makes only the second path complete the lesson.
4. **Handshake over `postMessage`, no token in the URL.** The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-fullscreen`), `referrerPolicy="no-referrer"`. The platform accepts only messages whose `origin` equals the embed origin, whose `source` is the iframe window and whose `data.source` is `lesson-sdk` with `v: 1`. On `lesson:hello` it starts an embed session and answers `lesson:init` with a random token, sent to the exact embed origin. The SDK accepts `lesson:init` only from `window.parent` (and from the configured `parentOrigin`, if any).
5. **Session tokens.** `catalog.embed_session` stores the sha256 of a 32-byte random token for about 2 hours, tied to lesson and user. Starting a session needs an active enrollment and is rate limited per user.
6. **Per-course signing secret.** `catalog.course_app_secret` holds one secret per course, encrypted with `encryptSecret`, shown in clear once when created or rotated. The endpoint verifies `HMAC-SHA256(ts + "." + rawBody)` with `timingSafeEqual`, a 300 s window, a 16 KB body cap and a non-decreasing timestamp, and rechecks the active enrollment.
7. **Framing headers.** The platform sends `Content-Security-Policy: frame-ancestors 'self'` through Nitro route rules. The creator's app must allow `https://*.creatucurso.com.ar` and the academy's custom domain in its own `frame-ancestors`.

## Consequences

- A client-reported result can be forged by a student; that is why `verifiedOnly` exists and why only the signed path should back certificates.
- Creators who want the verified path need a backend that holds the course secret and forwards the session token the SDK exposes.
- Rotating the secret breaks the creator's backend until it is updated.
- Apps that forbid framing (`X-Frame-Options`, restrictive CSP) cannot be embedded.
