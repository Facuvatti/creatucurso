# Runbook (production, app machine)

All commands run from the repository root on the app machine. The stack is `infra/app/compose.yaml`; shorthand used below:

```sh
dc() { docker compose --env-file .env.production -f infra/app/compose.yaml "$@"; }
```

Ports (host side, loopback only except Caddy): Caddy 80/443, web 3210, worker 3211, Uptime Kuma 3212, Bugsink 8211. Postgres is not published. Development ports (3000, 3001, 5432, 5433, 5439, 8080, 9050, 3101, 3102) are never used here.

## First-time setup (in this order)

1. **Machine:** Docker + Compose plugin, a second disk mounted for backups (for example `/mnt/backup`).
2. **DNS** at your DNS host: `A`/`AAAA` for `example.com` and `*.example.com` to this machine; the DNS host's API token (edit DNS only) goes in `DNS_API_TOKEN`. Router/firewall: forward 80 and 443.
3. **Env:** `cp .env.production.example .env.production`, fill every value (each is commented). Generate secrets with `openssl rand -hex 32`. Create the backup directory: `sudo mkdir -p $BACKUP_DIR && sudo chown 999:999 $BACKUP_DIR`.
4. **Back up the keys now**, off this machine: `SECRETS_ENCRYPTION_KEY`, `WALG_LIBSODIUM_KEY`, `BETTER_AUTH_SECRET` (a password manager is enough).
5. **Build and start the database only:** `dc up -d --build db` and wait until `dc ps` shows it healthy.
6. **Schema as migration #1** (first deploy only, once):
   ```sh
   f=db/migrations/$(date -u +%Y%m%d%H%M%S)_initial_schema.sql
   { echo '-- migrate:up'; cat database/schema.sql; echo; echo '-- migrate:down'; echo 'select 1;'; } > "$f"
   git add db/migrations && git commit -m "feat(db): initial schema as migration 1"
   infra/app/migrate.sh up
   ```
   After that, every schema change is a new file: `infra/app/migrate.sh new add_something`, edit it (`-- migrate:up` / `-- migrate:down`), commit. Development still uses `database/schema.sql` and `pnpm db:reset`; keep both in step until the dev flow moves to migrations.
7. **Everything else:** `dc up -d --build`. The first Caddy build downloads xcaddy and takes minutes on a Pi; the first certificate (wildcard, DNS challenge) can take a minute or two.
8. **Ops tools:** open `https://errors.<domain>` (Bugsink; user from `BUGSINK_SUPERUSER`), create a project, copy its DSN into `SENTRY_DSN` (internal form `http://<key>@bugsink:8000/<id>`), `dc up -d web worker`. Open `https://status.<domain>` (Kuma), create the admin user and add monitors: `http://web:3000/health`, `http://worker:3101/health`, the public site, the payments machine health URL.
9. **Check:** `dc ps` (all healthy), `curl https://app.<domain>/health` returns `{"ok":true,"db":true,...}`, `dc logs backup` shows `base backup ok`.

## Deploy

```sh
git pull
dc build web                 # worker uses the same image
infra/app/migrate.sh up      # run migrations once, before the new code starts
dc up -d web worker
dc ps && curl -fsS https://app.<domain>/health
```

Before: CI is green (typecheck + build), migrations are backward compatible with the running version (add columns before using them, remove them in a later deploy), and `git tag` the release. Keep the previous image: `docker tag creatucurso:latest creatucurso:previous` before building.

## Rollback

1. Code only: `docker tag creatucurso:previous creatucurso:latest && dc up -d --no-build web worker`.
2. Migration that must be undone: `infra/app/migrate.sh rollback` (runs the last `-- migrate:down`), then step 1. If a migration lost data, restore with the drill below instead.

## Backups and restore drill

What is backed up: Postgres base backup daily + WAL continuously (WAL-G, encrypted, in `$BACKUP_DIR/wal-g`, 7 full backups kept). **Not covered by WAL-G, back up separately:**

- `SECRETS_ENCRYPTION_KEY`, `WALG_LIBSODIUM_KEY`, `BETTER_AUTH_SECRET`, `.env.production` (off this machine).
- Original uploaded videos in `MEDIA_ROOT` while they are inside the 7-day window (see `infra/media`); copy that directory to the backup disk daily (`rsync -a`) and note it in the media runbook.
- Caddy's `caddy-data` volume is not essential (certificates are re-issued), Kuma's `kuma-data` and Bugsink's `bugsink-data` are nice to have.

Check status any time: `dc exec backup wal-g backup-list` and `dc logs --tail 20 backup`.

**Restore drill** (do it before launch and after each release; it never touches production):

```sh
# 1. scratch volume + restore the latest base backup into it
docker run --rm -v drill-pgdata:/var/lib/postgresql/data -v "$BACKUP_DIR":/backups \
  -e WALG_FILE_PREFIX=/backups/wal-g -e WALG_LIBSODIUM_KEY="$WALG_LIBSODIUM_KEY" \
  -e WALG_LIBSODIUM_KEY_TRANSFORM=hex --user postgres creatucurso-db:16 \
  sh -c 'wal-g backup-fetch /var/lib/postgresql/data LATEST && touch /var/lib/postgresql/data/recovery.signal \
  && echo "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'" >> /var/lib/postgresql/data/postgresql.auto.conf'
# 2. start a throwaway Postgres on it (port 5450, not used by anything else)
docker run -d --name drill-pg -p 127.0.0.1:5450:5432 -v drill-pgdata:/var/lib/postgresql/data \
  -v "$BACKUP_DIR":/backups -e WALG_FILE_PREFIX=/backups/wal-g -e WALG_LIBSODIUM_KEY="$WALG_LIBSODIUM_KEY" \
  -e WALG_LIBSODIUM_KEY_TRANSFORM=hex creatucurso-db:16
# 3. wait for "database system is ready" in `docker logs drill-pg`, then compare
docker exec drill-pg psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c 'select count(*) from auth."user"; select count(*) from events.outbox;'
# 4. clean up
docker rm -f drill-pg && docker volume rm drill-pgdata
```

Pass when the user count and newest rows match production (within the archive_timeout of 5 minutes). Write the date of the drill at the bottom of this file. **Real restore:** stop `web worker backup db`, replace the `pgdata` volume with the restored data (same steps, volume `creatucurso_pgdata`), start `db`, run `dc up -d`.

## When something is down

- **Hyperswitch (payments machine) down:** checkouts fail with an error message, nothing is lost. Webhooks are retried by Hyperswitch when it is back. Start it there with `infra/hyperswitch/up.sh up`; then buy a test course. Paid-but-not-enrolled students: check the outbox backlog in `/health` after recovery.
- **Worker down:** the web keeps serving; events (enrollment side effects, emails) pile up in `events.outbox` and are delivered when the worker returns. `dc logs --tail 100 worker`, `dc restart worker`. A growing `outboxBacklog` in `/health` with a healthy worker means a failing event: look at `last_error` in `events.outbox`.
- **Encoder / media node down:** viewers can still play already encoded videos; new uploads wait. See `infra/media` for its own steps.
- **Database down:** web reports `/health` 503. `dc logs db`, free disk space (WAL archive fills `$BACKUP_DIR` if backups fail: check `dc logs backup`), `dc restart db`. If data is damaged, use the restore drill steps.
- **Certificates:** `dc logs caddy`. A wildcard failure usually means an expired `DNS_API_TOKEN`.

## R1 acceptance: how the owner checks each item

| Item | How |
|---|---|
| Stack healthy from clean checkout | `dc up -d --build`, then `dc ps` shows every service healthy |
| Wildcard subdomain resolves | open `https://anything.<domain>`; browser shows a valid certificate (page may say the academy does not exist) |
| Custom domain | add a verified custom domain in the panel, open it over HTTPS; a domain not in the panel must NOT get a certificate (`dc logs caddy`) |
| Custom domain (Cloudflare tunnel) | needs `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID` (setup in `docs/cloudflare.md`, ADR-0024): add `cursos.<test domain>` in the panel, create the CNAME, wait for "Activo" (worker checks every minute), open it over HTTPS |
| Worker consumes the outbox | buy a test course, then `curl https://app.<domain>/health`: `outboxBacklog` returns to 0; `dc logs worker` shows `event delivered` |
| Errors reach the tracker | `dc exec web node -e "import('@sentry/node').then(S=>{S.init({dsn:process.env.SENTRY_DSN});S.captureMessage('test');return S.flush(2000)})"`; the message shows in Bugsink |
| Uptime alerts | stop `worker` for 2 minutes; Kuma shows it down; start it again |
| Backup restore drill | run the drill above |
| Landing | open `https://<domain>`: text, "Crear mi academia" leads to login then create academy; footer links `/terminos` and `/privacidad` |
| Publish, pay, watch, refund | the product checklist of the plan (Phases 3, 4, 6) |

## Open items

- TODO legal: `/terminos` and `/privacidad` do not exist yet (the landing links to them). The texts must be written with a local professional before the first real sale (Ley 25.326). Do not publish placeholder legal text.
- Unverified on hardware: xcaddy build, WAL-G binary and libsodium encryption, Bugsink variables/healthcheck, Kuma healthcheck. Run the first-time setup and the restore drill once and fix what differs (record it in ADR-0022).

Restore drills done: _(none yet)_
