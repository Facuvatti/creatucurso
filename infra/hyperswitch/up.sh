#!/usr/bin/env bash
# Start / stop / inspect a local Hyperswitch for development.
#   infra/hyperswitch/up.sh up       clone (first time), start, wait until healthy
#   infra/hyperswitch/up.sh status   show containers and the health check
#   infra/hyperswitch/up.sh logs     follow the API logs
#   infra/hyperswitch/up.sh down     stop (keeps data); use "reset" to wipe it
#   infra/hyperswitch/up.sh reset    stop and delete Hyperswitch's database
set -euo pipefail

TAG="${HYPERSWITCH_TAG:-2026.09.30.0-hotfix2}"
DIR="${HYPERSWITCH_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)/hyperswitch}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVICES=(pg redis-standalone migration_runner superposition superposition-init hyperswitch-server hyperswitch-web)

compose() { (cd "$DIR" && docker compose "$@"); }

case "${1:-status}" in
  up)
    if [ ! -d "$DIR/.git" ]; then
      git clone --depth 1 --branch "$TAG" https://github.com/juspay/hyperswitch.git "$DIR"
    fi
    cp "$HERE/docker-compose.override.yml" "$DIR/docker-compose.override.yml"
    # The first start downloads several GB on a Raspberry Pi; be patient.
    compose up -d "${SERVICES[@]}"
    echo "Waiting for http://localhost:18080/health ..."
    for _ in $(seq 1 90); do
      if curl -fsS -m 3 http://localhost:18080/health >/dev/null 2>&1; then
        echo "Hyperswitch is up."; exit 0
      fi
      sleep 5
    done
    echo "Not healthy yet. Run: $0 logs" >&2; exit 1 ;;
  status)
    compose ps
    curl -fsS -m 3 http://localhost:18080/health && echo || echo "API not answering on :18080" ;;
  logs) compose logs -f --tail=100 hyperswitch-server ;;
  down) compose down ;;
  reset) compose down -v ;;
  *) echo "usage: $0 up|status|logs|down|reset" >&2; exit 2 ;;
esac
