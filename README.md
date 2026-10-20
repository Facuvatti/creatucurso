# Creatucurso

A platform where creators sell online courses from their own subdomain
(`maria.<domain>`) or custom domain. Payments go straight to the creator
(Hyperswitch or Mercado Pago), videos are protected (encrypted HLS), and the
platform owner runs everything on a small ARM machine. TanStack Start + Postgres +
better-auth, Node 22, pnpm 10.

## Run in development

```sh
cp .env.example .env                       # then edit the values you need
docker compose -f compose.dev.yaml up -d   # Postgres on port 5439
pnpm install
pnpm db:reset                              # creates the schema from database/schema.sql
pnpm dev                                   # http://localhost:3000 and http://app.localhost:3000
pnpm worker                                # optional: outbox worker
infra/hyperswitch/up.sh up                 # optional: local payments (slow the first time)
```

`pnpm typecheck` and `pnpm build` are what CI runs. There is no automated test
suite; the owner runs the manual acceptance checklists (see the runbook).

## Ports

| Port | What | Where |
|---|---|---|
| 3000 | web app | development |
| 3101 | worker health route | development |
| 5439 | Postgres | development |
| 8080 | Hyperswitch API | development |
| 9050 | Hyperswitch checkout widget | development |
| 3210 | web (loopback) | production |
| 3211 | worker (loopback) | production |
| 3212 | Uptime Kuma (loopback) | production |
| 8211 | Bugsink (loopback) | production |
| 80, 443 | Caddy | production |

## Documentation

- [Production runbook](docs/runbook.md): first-time setup, deploy, rollback, backups, incidents.
- [Hyperswitch locally](docs/hyperswitch.md) and [Mercado Pago](docs/mercadopago.md).
- Decisions in [docs/adr](docs/adr), for example [code conventions](docs/adr/0014-simple-code-conventions.md),
  [Caddy and TLS](docs/adr/0018-caddy-on-demand-tls.md), [ARM table](docs/adr/0019-arm-compatibility.md)
  and [ops stack](docs/adr/0022-ops-stack.md).
- Production files: `Dockerfile`, `infra/app/` (compose, Caddy, backups, migrations) and `.env.production.example`.
