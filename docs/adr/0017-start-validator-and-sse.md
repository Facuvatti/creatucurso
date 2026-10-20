# ADR-0017: TanStack Start validator method and server-sent events

**Status:** Accepted (docs and types only, nothing was run)
**Date:** 2026-10-20

## Context
Phase 0 asked which method validates server function input (`.inputValidator()` or `.validator()`) and whether server-sent events (chat, Phase 9) work.

## Decision
1. **Validator.** The installed `@tanstack/react-start` 1.169.3 (`start-client-core`) exposes only `.validator(...)` on `createServerFn` (`ValidatorFn` in `createServerFn.d.ts`); there is no `.inputValidator`. We keep `.validator` with hand-written checks (ADR-0014). If a future upgrade renames it, the type checker fails on every server function and the change is a mechanical rename.
2. **SSE.** Server routes (`createFileRoute(...).server.handlers`) return a standard Web `Response`, so a `ReadableStream` body with `Content-Type: text/event-stream` is possible on the self-hosted Node server. The server-function handler also has stream support. This is read from types, not exercised.

## Fallback
If streaming responses are buffered (by Start, nitro or Caddy), the chat falls back to short polling (every 3-5 s on the open conversation) with the same message API. Caddy needs `flush_interval -1` on the SSE path. The first task of Phase 9 is a 20-line streaming route to confirm before building on it.

## Consequences
No code change now. Phase 9 owns the real verification.
