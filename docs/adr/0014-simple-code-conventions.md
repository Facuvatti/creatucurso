# ADR-0014: Simple code conventions (few moving parts)

**Status:** Accepted (owner decision, 2026-10-19)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

The first phases were written in a layered style: ports and repository classes with a single implementation, a dependency container, an environment wrapper, a schema library for validation and a large automated test suite. The owner maintains the platform alone and wants few moving parts: code that can be read top to bottom, with as little indirection and tooling as possible.

## Decision

1. **No schema library.** `zod` is gone from our code and dependencies. Inputs are checked by hand at the trust boundaries only: server function inputs, the Hyperswitch webhook body, the JSON course importer and URL search params. Each check returns or throws a clear message. Everything else relies on the database (NOT NULL, CHECK, FK, UNIQUE).
2. **No repositories, ports or interfaces with one implementation.** Each area exports plain functions and the SQL is written inline in the function that uses it, on one shared `pg` pool (`src/server/db.server.ts`). There is no container. Pure helpers (host classification, slugs, money, secret box, payment status mapping, signature check, course-from-import) stay as plain function files. The tenant cache is a small in-memory cache inside the tenancy area.
3. **No environment wrapper.** `process.env.NAME` is read directly where it is needed and fails with a clear error when a required value is missing. `--env-file` stays in the package scripts; scripts may call `process.loadEnvFile()`. `tenantOrigin` and `appOrigin` are small plain functions.
4. **Few, coarse areas.** `src/areas/<tenancy|identity|catalog|payments|community>/` with only a few files each and no `domain/application/infrastructure` folders. Server functions stay in `src/server/*.functions.ts` and call the areas directly.
5. **No automated tests or test tooling.** Unit tests, end-to-end tests, Vitest and Playwright are removed. The owner runs the manual acceptance checklist at the end of each release. CI runs typecheck and build only.

## Why

Every abstraction and tool is something to learn, upgrade and keep consistent. With one implementation per concern and one maintainer, the abstractions only added files to open. Direct SQL and plain functions make behaviour visible where it happens, and manual acceptance checks cover what matters at this size.

## Consequences

- Refactors rely on the type checker and manual checks instead of tests.
- Swapping the payment gateway or database later means editing the area's functions directly. We accept that and introduce an interface only when a real second implementation appears.
- `kysely` stays a direct dependency only because `better-auth` needs a `PostgresDialect` for the `auth` schema.
