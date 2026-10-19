# ADR-0006: Tutor-student chat with self-hosted OpenIM

**Status:** Proposed (gated on target host capacity and on the tenant-boundary check)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Tutors (added by a creator to specific courses) and enrolled students need a chat. The owner chose self-hosted OpenIM.

Verified in the OpenIM documentation:
- The Docker deployment defines about 14 services: MongoDB 7, Redis 7, etcd, Kafka 3.5.1, MinIO, `openim-server`, `openim-chat`, web and admin front ends, and a monitoring set (Prometheus, Alertmanager, Grafana, node-exporter). It requires Docker Engine 20.10 or higher.
- Our backend can register users and issue per-user tokens with an administrator token (`/auth/get_user_token` with `platformID` and `userID`). The documentation says the administrator token must never reach client applications.
- Clients can search friends and create groups through the SDKs.

Not verified: memory and CPU needs of the stack, availability of ARM images, and how to disable or restrict client-side friend search, friend requests and group creation.

## Decision

Keep OpenIM as the chat engine, with these rules:
1. Our backend registers users lazily and issues OpenIM tokens only after an authorization check (enrolled student with an assigned tutor, or the tutor/creator). The administrator token lives only on the server.
2. OpenIM user IDs are random and opaque (never emails or sequential IDs), so a client cannot guess other users' IDs.
3. Conversations and groups are created by our backend with administrator calls, never by clients. Restriction of client-side friend and group creation is verified before launch (see Action Items).
4. The chat stack is deployed as its own Docker Compose project and is **not** started until the host capacity check passes.

## Options Considered

### Option A: OpenIM (chosen by the owner)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High (many services to run) |
| Cost | Hardware and operations |
| Scalability | Designed for large scale |
| Team familiarity | Low |

**Pros:** complete chat features (history, groups, files, push), maintained SDKs.
**Cons:** large footprint for a self-hosted host; the tenant boundary relies on our backend because clients hold OpenIM tokens.

### Option B: Minimal in-app chat on our own database
Messages in Postgres with server-sent events or WebSocket delivery, scoped by course and enrollment, using our existing authorization.
**Pros:** no extra infrastructure; the tenant boundary is the same code that already guards courses.
**Cons:** we build and maintain the chat features ourselves (attachments, read state, notifications).

## Trade-off Analysis

For one-to-one conversations between a tutor and a student of a course, Option B is much smaller and keeps authorization in one place. Option A gives more features at a much higher operating cost. The decision depends on the capacity of the target host and on how much chat functionality is really needed.

## Consequences

- If OpenIM is kept, the compose setup grows by the whole OpenIM stack and its backups.
- If the host cannot run it comfortably, the fallback is Option B for v1 and OpenIM later.

## Action Items

1. [ ] Get the target host specs (RAM, CPU, architecture) and compare with the OpenIM stack requirements, including ARM image availability.
2. [ ] Find out how to restrict friend requests, user search and group creation from clients, and test that a client token cannot reach users outside its allowed conversations.
3. [ ] Decide message retention and who can export or delete history.
4. [ ] If the checks fail, switch to Option B and mark this ADR superseded.
