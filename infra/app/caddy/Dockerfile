# Caddy with a DNS-challenge plugin, needed for the wildcard certificate (ADR-0018).
# Change DNS_PROVIDER to your DNS host (list: https://github.com/caddy-dns).
FROM caddy:2-builder AS build
ARG DNS_PROVIDER=cloudflare
RUN xcaddy build --with github.com/caddy-dns/${DNS_PROVIDER}

FROM caddy:2
COPY --from=build /usr/bin/caddy /usr/bin/caddy
