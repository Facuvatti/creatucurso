# Running Hyperswitch locally

Hyperswitch is a separate service (its own Docker project). Our app only talks to
it over HTTP. Nothing from Hyperswitch is copied into this repository except the
small helper in `infra/hyperswitch/`.

## Start

```sh
infra/hyperswitch/up.sh up       # first run clones juspay/hyperswitch next to this repo
infra/hyperswitch/up.sh status   # containers + health check
infra/hyperswitch/up.sh logs     # API logs
infra/hyperswitch/up.sh down     # stop, keep data
infra/hyperswitch/up.sh reset    # stop and wipe Hyperswitch's database
```

The first start pulls several GB of images (slow on a Raspberry Pi). It is ready
when `curl http://localhost:8080/health` answers `health is good`.

Only two ports are published on your machine, so nothing clashes with other
Postgres/Redis you run:

| Port | What | Used by |
|---|---|---|
| 8080 | Hyperswitch API | the app (server) and the browser (checkout) |
| 9050 | Checkout widget (`HyperLoader.js`) | the browser |

Hyperswitch's own Postgres, Redis and Superposition are internal to Docker.
To change the checkout location: `HYPERSWITCH_DIR=/some/path infra/hyperswitch/up.sh up`.

## Environment variables of the app (`.env`)

They are all listed with comments in `.env.example`. The ones that confuse:

- `HYPERSWITCH_URL` vs `HYPERSWITCH_PUBLIC_URL`: same thing locally
  (`http://localhost:8080`). They differ in production, where the server may use an
  internal address and the browser a public one.
- `HYPERSWITCH_ADMIN_API_KEY`: `test_admin` for this Docker setup.
- `HYPERSWITCH_WEBHOOK_BASE_URL`: the address the **Hyperswitch container** uses to
  call the app. `localhost` would be the container itself, so use
  `http://host.docker.internal:<app port>`.
- `SECRETS_ENCRYPTION_KEY`: `openssl rand -base64 32`. Do not lose it: stored creator
  credentials cannot be decrypted without it.

## Check that it works from the app

1. Start Hyperswitch and the app (`pnpm dev`), sign in as a creator.
2. `Panel > Pagos`: activate payments (creates the merchant in Hyperswitch).
3. Connect a test payment provider, set a price on a course, then buy it as a student.
4. After paying, the student must be enrolled exactly once (the webhook can arrive twice).

## Known quirks (already handled by `infra/hyperswitch/docker-compose.override.yml`)

- Upstream's database health check is too short for a Raspberry Pi; we lengthen it.
- Upstream's seed script needs bash but is run with `sh`; we run it with bash.
- Upstream's migration step fails patching a Rust file with the current diesel; we run only the migrations.
- `hyperswitch-web` (port 9050) builds the checkout widget from source on its first start. On a Pi this takes a long time; `http://localhost:9050/HyperLoader.js` answers once it finishes (`docker logs -f hyperswitch-hyperswitch-web-1`). The API on 8080 works without it.
