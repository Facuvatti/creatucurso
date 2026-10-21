#!/usr/bin/env bash
# Starts, stops or checks everything the app needs in development.
#   scripts/stack.sh          same as "restart"
#   scripts/stack.sh restart  stop everything, then start it again
#   scripts/stack.sh stop
#   scripts/stack.sh status
#
# Started: database (Docker), media servers tusd + nginx (Docker), the web app,
# the worker and the video encoder. Logs go to logs/*.log.
# Hyperswitch is separate: infra/hyperswitch/up.sh up
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs

# Ports of the three Node processes (see package.json and the media encoder).
APP_PORT=4310
WORKER_PORT=4311
ENCODER_PORT=4312

load_env() {
  # Docker Compose reads ${VARS} from the shell, so the env file is loaded here.
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi
}

stop_port() {
  local pids
  pids=$(ss -ltnp 2>/dev/null | grep -E ":$1 " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
}

stop_all() {
  echo "Stopping app, worker and encoder..."
  stop_port "$APP_PORT"
  stop_port "$WORKER_PORT"
  stop_port "$ENCODER_PORT"
}

start_docker() {
  echo "Starting database and media servers (Docker)..."
  docker compose -f compose.dev.yaml up -d
  load_env
  docker compose -f infra/media/compose.yaml up -d tusd nginx
}

start_node() {
  load_env
  echo "Starting app, worker and encoder..."
  setsid nohup pnpm dev >logs/app.log 2>&1 &
  setsid nohup pnpm worker >logs/worker.log 2>&1 &
  setsid nohup pnpm media:encode >logs/encoder.log 2>&1 &
}

wait_for() {
  local name=$1 url=$2
  for _ in $(seq 1 40); do
    if curl -s -m 2 -o /dev/null "$url"; then
      echo "  $name: up"
      return 0
    fi
    sleep 2
  done
  echo "  $name: NOT answering (see logs/)"
  return 1
}

status() {
  echo "Status:"
  curl -s -m 3 -o /dev/null "http://localhost:$APP_PORT/" && echo "  app: up" || echo "  app: down"
  curl -s -m 3 "http://localhost:$WORKER_PORT/health" >/dev/null && echo "  worker: up" || echo "  worker: down"
  curl -s -m 3 "http://localhost:$ENCODER_PORT/health" >/dev/null && echo "  encoder: up" || echo "  encoder: down"
  docker ps --format '  docker: {{.Names}} {{.Status}}' | grep -E 'creatucurso-db|media-' || true
}

case "${1:-restart}" in
  stop) stop_all ;;
  status) status ;;
  restart | start)
    stop_all
    start_docker
    start_node
    wait_for app "http://localhost:$APP_PORT/"
    wait_for worker "http://localhost:$WORKER_PORT/health"
    wait_for encoder "http://localhost:$ENCODER_PORT/health"
    ;;
  *)
    echo "usage: $0 [restart|stop|status]" >&2
    exit 2
    ;;
esac
