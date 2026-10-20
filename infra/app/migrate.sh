#!/usr/bin/env bash
# Runs dbmate against the production database (a container on the compose network).
#   infra/app/migrate.sh up          apply pending migrations (the deploy step)
#   infra/app/migrate.sh status      list applied / pending
#   infra/app/migrate.sh rollback    undo the last migration
#   infra/app/migrate.sh new name    create db/migrations/<timestamp>_name.sql
set -euo pipefail
cd "$(dirname "$0")"
exec docker compose --env-file ../../.env.production -f compose.yaml run --rm migrate "$@"
