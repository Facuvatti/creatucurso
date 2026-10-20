# ADR-0019: ARM (aarch64) compatibility table

**Status:** Accepted
**Date:** 2026-10-20

## Context
Development runs on a Raspberry Pi 4 and production on an ARM server. Every container must have an `arm64` image.

## Method
`docker manifest inspect <image>` on 2026-10-20 (registry state, not run on hardware).

| Component | Image checked | arm64 | Notes |
|---|---|---|---|
| Postgres | `postgres:17` | yes | official multi-arch |
| Redis | `redis:7` | yes | official multi-arch |
| nginx | `nginx:1.27` | yes | official multi-arch |
| Caddy | `caddy:2` | yes | custom DNS plugin build needs `xcaddy`, unverified on ARM |
| tusd | `tusproject/tusd` | yes | |
| dbmate | `ghcr.io/amacneil/dbmate` | yes | |
| Hyperswitch router | `docker.juspay.io/juspaydotin/hyperswitch-router:standalone` | yes | already in use on the Pi (docs/hyperswitch.md) |
| Hyperswitch control center / web | `juspaydotin/hyperswitch-control-center`, `hyperswitch-web` | yes | |
| Bugsink | `bugsink/bugsink` | yes | |
| GlitchTip | `glitchtip/glitchtip` | yes | |
| Uptime Kuma | `louislam/uptime-kuma:1` | yes | |
| ffmpeg | `mwader/static-ffmpeg` (arm64), or Debian `ffmpeg` package | yes | ffmpeg is installed in the app/worker image from apt |
| WAL-G | no official image checked | unverified | upstream release assets include aarch64 builds; confirm or compile in the Dockerfile |

## Decision
Nothing blocks ARM. Two items stay unverified until Phase 14: WAL-G (binary, not image) and the Caddy DNS plugin build.

## Fallback
If WAL-G has no usable aarch64 binary, build it from source in a multi-stage Dockerfile, or use `pg_basebackup` plus archived WAL with `pgBackRest` (available in Debian arm64).
