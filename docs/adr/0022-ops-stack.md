# ADR-0022: Operations stack on the app machine

**Status:** Accepted
**Date:** 2026-10-20

## Context
Phase 14 needs logging, error tracking, uptime monitoring, backups and migrations on a Raspberry-class ARM machine, run by one person. Every piece must have an arm64 image or binary (ADR-0019) and few moving parts (ADR-0014).

## Decision
- **Logging:** `pino` JSON to stdout (`src/server/log.server.ts`); Docker `json-file` with `max-size: 10m`, `max-file: 5` on every service. `pino-pretty` only in development.
- **Error tracker: Bugsink** (`bugsink/bugsink:2`, arm64 manifest checked on 2026-10-20). One container with SQLite in a volume, accepts the Sentry SDK (`@sentry/node`, enabled by `SENTRY_DSN`). GlitchTip also has arm64 images but needs Postgres, Redis and a worker, which is too much for this machine. Bugsink is source-available under a non-OSI license (check it before offering it as a service to others; we only use it internally).
- **Uptime:** Uptime Kuma v1 (`louislam/uptime-kuma:1`, arm64). Monitors `web:3000/health`, `worker:3101/health`, the public site and the payments machine.
- **Backups: WAL-G** to a different disk (file storage, libsodium-encrypted). No official image: `infra/app/backup/Dockerfile` downloads the `wal-g-pg-22.04-aarch64` release asset (exists in v3.0.9). Postgres archives WAL continuously; a `backup` container takes a daily base backup. Fallback from ADR-0019 (pgBackRest) stays valid if the binary fails on the machine.
- **Migrations: dbmate** (`ghcr.io/amacneil/dbmate`, arm64) run by `infra/app/migrate.sh`. `database/schema.sql` becomes migration #1 at the first production deploy; development keeps `pnpm db:reset`.
- **TLS:** Caddy built with xcaddy and the `caddy-dns/cloudflare` plugin by default (`DNS_PROVIDER` build argument changes it), as designed in ADR-0018.
- **Network:** `back` network is `internal` (database, backups); `front` has Caddy, web, worker and the ops tools. Only Caddy publishes public ports (80, 443). Other services publish on `127.0.0.1` with ports that do not clash with the development ports: web 3210, worker 3211, Kuma 3212, Bugsink 8211.

## Unverified until the first real deploy
Nothing here ran on the target hardware: the xcaddy build, the WAL-G binary and its libsodium encryption, Bugsink environment variable names and healthcheck, and the Kuma healthcheck path. The runbook lists the checks.

## Consequences
One compose file to read. Backups depend on one extra image we build ourselves. Bugsink on SQLite is fine for this volume of errors; move it to Postgres if it grows.
