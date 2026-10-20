# ADR-0020: Basic-tier video upload, encoding and serving

**Status:** Accepted (implemented in Phase 6; load test still pending per ADR-0012)
**Date:** 2026-10-20
**Deciders:** Facu

## Context

The Basic tier delivers AES-128 encrypted HLS from our own server (ADR-0012). We need resumable uploads, a queue-based encoder, and a way to serve segments that only enrolled students can fetch, without the Node app streaming video bytes.

## Decision

**Upload.** The browser uploads with `tus-js-client` to `tusd`, behind nginx at `<MEDIA_PUBLIC_URL>/files/`. Before uploading, the panel calls a server function (`startVideoUpload`) which checks that the person is owner, admin or tutor of the lesson's course, checks size and quota, creates the `media.video` row (status `uploading`) and returns a signed upload token (HMAC, 6 hours, bound to the video id). The browser sends it as `Authorization: Bearer` and the video id as tus metadata. tusd forwards that header to its HTTP hook (`POST /api/media/tus-hook`), because the media host has no cookies of the tenant host. `pre-create` verifies the token, that the declared size equals the registered one, and renames the upload to the video id; `post-finish` sets `uploaded`. tusd cannot add custom headers to hook calls, so the shared secret `MEDIA_HOOK_SECRET` travels in the hook URL query string on the internal network (the `x-media-hook-secret` header is accepted too). Later PATCH requests are not hooked: the upload id is an unguessable UUID and works as the capability, as in any tus deployment. Resuming after a cut or a reload finds the previous upload by tus fingerprint; the server reuses the half-sent video when the size matches.

**Validation and encoding.** The encoder is its own process (`pnpm media:encode`, concurrency 1). It takes `uploaded` rows with `FOR UPDATE SKIP LOCKED` (the `status` column is the queue), runs `ffprobe` (real container: `mov` for MP4/MOV, `matroska` for MKV/WebM; video stream; duration up to `MEDIA_MAX_SECONDS`) and encodes 480p (1.2 Mbit/s) and 720p (2.5 Mbit/s), only renditions not above the source height, in 6-second segments with one random 16-byte AES key per video. The key is stored encrypted with the existing secret box. Originals are deleted 7 days after success; failed jobs keep the original and the reason (Spanish) is shown in the panel.

**Serving: nginx `secure_link`.** Playlists and the key come from the app; segments are static files served by nginx.
- `POST /api/media/session` checks access (active enrollment, or staff/tutor of the course), takes a place in the stream cap (`media.playback_session`, advisory lock, live = heartbeat in the last 90 s, default cap 30) and returns the master playlist URL with a playback token (HMAC, 3 hours).
- `GET /api/media/playlist/<video>/<name>?t=` serves the stored playlist rewritten per playback: the `EXT-X-KEY` URI becomes `/api/media/key/<video>?t=<token>` and each segment becomes `<MEDIA_PUBLIC_URL>/hls/<sig>/<exp>/<video>/<file>.ts`. The signature is `md5("<exp>/<video> <MEDIA_SECRET>")` in base64url, so it **signs the video's directory prefix**: one signature covers every segment of every rendition until `<exp>`, and nginx checks it with `secure_link` without calling the app.
- `GET /api/media/key/<video>?t=` validates the token, requires the playback session to still exist, and returns the raw key with `Cache-Control: no-store`.
- `POST /api/media/heartbeat` extends the session every 30 s while playing, re-checks the enrollment (a refund stops playback within a heartbeat), and adds to `media.playback_usage` (plays, seconds, bytes reported by the player) for Phase 8. Bytes are client-reported; nginx access logs stay the authoritative source if billing needs exact numbers.

**CORS.** The segments and `/files/` are cross-origin from the tenant site. Playlists and the key are same-origin (served by the app on the tenant host), so only nginx needs CORS. nginx allows the platform's subdomains by regex (`PLATFORM_DOMAIN`) and the verified custom domains listed in `allowed-origins.map`, a file the encoder rewrites every minute from `auth.organization`. nginx rereads it on reload; a small sidecar sends SIGHUP every 5 minutes. tusd runs with `-disable-cors` so nginx is the single rule. CORS does not protect the video (the signed URL does); it keeps other sites' scripts from reading responses.

## Options Considered

- **nginx `secure_link` (chosen):** segments never pass through Node; stateless check; one prefix signature per playback.
- **Caddy `forward_auth` to the app per segment:** simpler policy (always the live enrollment) but one app call per 6-second segment per viewer; kept as the alternative if revocation must be immediate.
- **Signing every segment URL:** longer playlists and CPU for no extra protection, since the whole video is reachable by one session anyway.
- **App-answered CORS (nginx `auth_request`):** exact per-host answers but a subrequest per segment; the map file is enough.

## Consequences

- A leaked signed prefix gives the segments until it expires (3 hours), but they are useless without the key, which needs a live playback session. The key reaches the browser: this deters, it does not prevent recording (plan limitation).
- Refund or revocation stops the key and the heartbeat, not segments already signed.
- The app and the encoder need read access to `MEDIA_ROOT` on the same disk as nginx; moving to object storage later means changing `renderPlaylist` and the encoder output.
- Unverified until the load test: the compose fragment (`infra/media/compose.yaml`), the nginx regex/CORS rules, tusd hook payload handling and the `nginx-reload` sidecar were not run end to end.
