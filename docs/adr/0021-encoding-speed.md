# ADR-0021: Encoding speed on the ARM server class (Phase 0 test)

**Status:** Accepted
**Date:** 2026-10-20
**Deciders:** Facu

## Context

Phase 0 asks how long encoding takes before committing to the self-hosted Basic tier (ADR-0012, ADR-0020). Encoding runs on the same machine class as the app, so it must not starve the website.

## Test

- Machine: Raspberry Pi 4 (4 cores, aarch64), ffmpeg 7.1.5 (Debian), run **once**.
- Input: 120 s of 1080p30 `testsrc2` + `sine` (H.264 + AAC, 233 MB).
- Command: the encoder's own `ffmpegArgs()` (`src/media/encoder.ts`), run under `nice -n 10`: split into 480p (1.2 Mbit/s) and 720p (2.5 Mbit/s), 6-second segments, AES-128, master playlist, AAC 128 kbit/s.
- Caveat: other agents and builds were using the machine during the test (load average 10 to 15 on 4 cores), so the numbers are pessimistic. Synthetic `testsrc2` content is also harder to compress than a talking-head lesson.

## Results

| Encoder | Wall time | CPU time (user+sys) | Average CPU | Speed | Output |
|---|---|---|---|---|---|
| `libx264 -preset veryfast` (software) | 3 min 44 s (224 s) | 9 min 51 s (607 s) | about 2.7 cores of 4 | 0.54x real time | 58 MB; 480p 1.35 and 720p 2.68 Mbit/s |
| `h264_v4l2m2m` (Pi hardware) | 2 min 0 s (120 s) | 5 min 53 s (366 s) | about 3.0 cores of 4 | 1.0x real time | 68 MB; 720p 3.4 Mbit/s (bitrate ignored) |

Generating the 2-minute source (software, `ultrafast`) took 84 s for reference.

Extrapolation (linear in duration, same load):

| Video length | Software | Hardware |
|---|---|---|
| 10 minutes | about 19 min | about 10 min |
| 1 hour | about 1 h 52 min | about 1 h |

## Findings

- Software encoding runs at about half of real time on this board; with an idle machine it should be somewhat better (not measured).
- The hardware encoder is about 1.9x faster but still decodes and scales on the CPU (about 3 cores busy), does not respect the target bitrate (720p came out 36 percent above the 2.5 Mbit/s that ADR-0012 budgets for bandwidth), and does not write the `CODECS` attribute in the master playlist. It is not used.
- A full-length 1-hour video (the limit) takes about two hours to encode in software. With a queue that is acceptable only if uploads are infrequent.

## Decision

- Encode in software (`libx264 -preset veryfast`) with **concurrency 1** and `nice -n 10`, so the website keeps its share of the 4 cores. Do not raise concurrency on this class of machine: one job already uses about 2.7 cores.
- Keep `h264_v4l2m2m` out of the encoder. `ffmpegArgs()` accepts an alternative video codec option, so retrying it is a one-line change if a future measurement on an idle machine or newer firmware shows exact bitrates.
- Show "procesando" in the panel without a time promise; the 1-hour limit stays configurable (`MEDIA_MAX_SECONDS`).
- Revisit: encode on a separate node (the encoder is already its own process) if a creator uploads more than a few hours of video per day, and re-measure on the production ARM server on an idle machine.
