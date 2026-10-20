# Publishing the app through a Cloudflare Tunnel

Use this when the server has no public IP / open ports and everything goes out
through Cloudflare. In this mode **Caddy is not used**: Cloudflare provides the
HTTPS certificate and forwards traffic to the app through the tunnel.

## What you need

- A domain whose DNS is managed by Cloudflare (call it `example.com`).
- The `cloudflared` tunnel you already run (one tunnel can serve many domains).

## Which domain to use

Best: a **separate domain only for this platform**. It never clashes with your
other apps.

You can also reuse the domain you already tunnel. This works because a
specific hostname (for example `blog.example.com`) always wins over the
wildcard. The only rule: no creator may pick a slug equal to a hostname your
other apps already use (`app`, `www`, `api`, ... are already reserved).

Do not use a sub-subdomain such as `*.cursos.example.com`: Cloudflare's free
certificate only covers one level (`*.example.com`).

## Steps (Cloudflare dashboard, works from a phone)

1. **Zero Trust > Networks > Tunnels** > your tunnel > **Public hostnames** > Add:
   - Subdomain `*`, domain `example.com`, service `HTTP` -> `localhost:4310`
     (the port of `pnpm dev`; in production the `web` container port).
   - Add another one with an empty subdomain (the apex `example.com`) to the same service.
   - Cloudflare creates the DNS records (`CNAME` to the tunnel) by itself.
     Check in **DNS > Records** that both `*` and `@` exist and are orange (proxied).
2. If `localhost` does not work because `cloudflared` runs in a container, use the
   machine address instead (for example `http://host.docker.internal:4310` or the
   LAN IP).
3. In the app `.env` set:

   ```
   PLATFORM_DOMAIN=example.com
   PUBLIC_URL_SCHEME=https
   PUBLIC_PORT=
   BETTER_AUTH_URL=https://app.example.com
   ```

   Restart `pnpm dev`. Now `https://app.example.com` is the central app and
   `https://maria.example.com` is the academy with slug `maria`.

## Webhooks (Mercado Pago, Hyperswitch)

The same tunnel makes them reachable: the webhook URL shown in
**Panel > Cobros** already uses your public domain once `PLATFORM_DOMAIN` is set.

## Custom domains of creators (later)

With a tunnel there is no Caddy to issue certificates for `cursos.maria.com`.
The Cloudflare way is **Cloudflare for SaaS (Custom Hostnames)**: the creator
points a CNAME to `app.example.com`, you add the hostname in Cloudflare and it
issues the certificate. This is not wired into the app yet; subdomains
(`maria.example.com`) work without it.

## When you have a public IP (alternative)

Use `infra/app/compose.yaml` with Caddy instead (see `docs/runbook.md`):
DNS-only (grey) `A` records for `@` and `*`, a Cloudflare API token with
`Zone:DNS:Edit` in `DNS_API_TOKEN`, and ports 80/443 forwarded to the machine.
