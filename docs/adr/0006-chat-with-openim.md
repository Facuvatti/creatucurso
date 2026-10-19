# ADR-0006: Tutor-student chat with self-hosted OpenIM

**Status:** Proposed (gated on confirming the server CPU and on a smoke test of the stack on the target ARM server)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Tutors (added by a creator to specific courses) and enrolled students need a chat. The owner chose self-hosted OpenIM.

Verified in the OpenIM documentation:
- The Docker deployment defines about 14 services: MongoDB 7, Redis 7, etcd, Kafka 3.5.1, MinIO, `openim-server`, `openim-chat`, web and admin front ends, and a monitoring set (Prometheus, Alertmanager, Grafana, node-exporter). It requires Docker Engine 20.10 or higher.
- Our backend can register users and issue per-user tokens with an administrator token (`/auth/get_user_token`). The documentation says the administrator token must never reach client applications.
- Clients can search friends and create groups through the SDKs.

Target server (from the owner): ARM, 16 GB of RAM, up to 32 GB if needed.
- MongoDB documents that on arm64 it requires an **ARMv8.2-A or newer** CPU, and that Raspberry Pi 4 is unsupported. The development machine used for this project is a Raspberry Pi 4 (Cortex-A72), so the OpenIM stack cannot be run there; it can only be tested on the real server, and only if that server's CPU is ARMv8.2-A or newer (for example Cortex-A76 or newer).
- Not verified: ARM image availability for every component (for example the Kafka image), and the real memory use of the stack.

## Decision

Keep OpenIM as the chat engine, with these rules:
1. Our backend registers users lazily and issues OpenIM tokens only after an authorization check (enrolled student with an assigned tutor, or the tutor/creator). The administrator token lives only on the server.
2. OpenIM user IDs are random and opaque (never emails or sequential IDs).
3. **Clients may create users and groups on their own** (owner decision). The tenant boundary therefore rests on token issuance and on opaque IDs, not on restricting what a client can do inside OpenIM.
4. The chat stack runs as its own Docker Compose project and is only started once the server check below passes.

## Options Considered

### Option A: OpenIM (chosen by the owner)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High (many services to run) |
| Cost | Server resources and operations |
| Scalability | Designed for large scale |
| Team familiarity | Low |

**Pros:** complete chat features (history, groups, files, push), maintained SDKs.
**Cons:** large footprint; depends on a CPU level that not every ARM board has.

### Option B: Minimal in-app chat on our own database
Messages in Postgres with server-sent events or WebSocket delivery, scoped by course and enrollment.
**Pros:** no extra infrastructure; authorization is the code that already guards courses.
**Cons:** we build chat features ourselves (attachments, read state, notifications).

## Trade-off Analysis

With 16 to 32 GB, the memory footprint is plausible if the stack is tuned, so the deciding factor is CPU compatibility and ARM images. Option B remains the fallback if either fails.

## Consequences

- If OpenIM is kept, the compose setup grows by its whole stack, with its backups and monitoring.
- Because clients can create groups, a student who learns another user's OpenIM ID could message them; opaque random IDs that are never displayed keep this low.

## Action Items

1. [ ] Confirm the server's CPU model (`lscpu`), and verify it is ARMv8.2-A or newer.
2. [ ] Smoke-test the OpenIM compose stack on the real server: all images start on arm64, and measure idle and loaded memory use.
3. [ ] Decide message retention and who can export or delete history.
4. [ ] If the checks fail, adopt Option B for v1 and mark this ADR superseded.

## Sources

- MongoDB production notes (ARM requirement): https://www.mongodb.com/docs/current/administration/production-notes/
