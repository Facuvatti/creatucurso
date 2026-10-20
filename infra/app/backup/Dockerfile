# Postgres 16 with WAL-G. WAL-G has no official image, so the release binary is
# downloaded here. The aarch64 asset exists in v3.0.9 (checked in the GitHub
# release list, not executed on hardware). On x86 use wal-g-pg-22.04-amd64.
# Built on Debian (glibc) because the release binary is not static.
FROM postgres:16
ARG WALG_VERSION=v3.0.9
ARG WALG_ASSET=wal-g-pg-22.04-aarch64
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& curl -fsSL "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_ASSET}.tar.gz" \
		| tar -xz -C /usr/local/bin \
	&& mv "/usr/local/bin/${WALG_ASSET}" /usr/local/bin/wal-g \
	&& chmod +x /usr/local/bin/wal-g \
	&& apt-get purge -y curl && apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*
COPY base-backup.sh /usr/local/bin/base-backup.sh
RUN chmod +x /usr/local/bin/base-backup.sh
