#!/bin/sh
# Runs inside the "backup" service. Takes a base backup every BACKUP_INTERVAL_HOURS
# (default 24) and keeps the newest BACKUP_RETAIN_FULL ones (default 7). WAL
# segments are pushed continuously by Postgres itself (archive_command).
set -eu
PGDATA=/var/lib/postgresql/data
INTERVAL=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
RETAIN="${BACKUP_RETAIN_FULL:-7}"

until pg_isready -h db -U "$POSTGRES_USER" >/dev/null 2>&1; do sleep 5; done

while true; do
	echo "$(date -u +%FT%TZ) base backup start"
	if wal-g backup-push "$PGDATA" && wal-g delete retain FULL "$RETAIN" --confirm; then
		date -u +%s > /tmp/last-backup-ok
		echo "$(date -u +%FT%TZ) base backup ok"
	else
		echo "$(date -u +%FT%TZ) base backup FAILED" >&2
	fi
	sleep "$INTERVAL"
done
