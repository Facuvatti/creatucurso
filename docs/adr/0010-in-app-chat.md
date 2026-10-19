# ADR-0010: Tutor-student chat built into the app

**Status:** Accepted (owner decision: no MongoDB)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Tutors and enrolled students need a chat. ADR-0006 chose OpenIM, but its deployment requires MongoDB (plus Kafka, etcd, MinIO and others), and the owner decided not to use MongoDB. Development is done on a Raspberry Pi 4 (aarch64, 7.6 GB RAM), which could not run that stack anyway; the target server is ARM with 16 to 32 GB.

## Decision

Build a minimal chat inside the application on Postgres:
- Tables `conversation` (course, tutor or creator, student), `message` (sender, body, optional attachment, created at) and a per-user read position.
- Authorization in the existing service layer: a conversation exists only between a tutor (or the creator) and a student enrolled in a course that tutor is assigned to. Students cannot message each other.
- Real-time delivery with server-sent events from the Start server, behind a small publish/subscribe interface: in-memory for a single process; Postgres LISTEN/NOTIFY or Redis if more than one process runs.
- Attachments use the shared upload validator (real file type check, size limits, image re-encoding); message text is escaped when rendered.
- Unread-message email notifications go through the automations mechanism once it exists.

## Options Considered

### Option A: In-app chat on Postgres (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium (we build a small feature set) |
| Cost | Low (no extra services) |
| Scalability | Good for this use case (one-to-one conversations per course) |
| Team familiarity | High |

**Pros:** no new infrastructure; authorization is the same code that guards courses; runs on the development machine.
**Cons:** we maintain features ourselves (read state, attachments, notifications).

### Option B: OpenIM (ADR-0006)
Rejected: requires MongoDB and a 14-service stack.

### Option C: Another self-hosted chat server
Not evaluated; most alternatives add a separate service with its own user model, which the in-app option avoids.

## Consequences

- Easier: one database, one authorization model, development on the current machine.
- Harder: group chat, push notifications and rich messaging features are out of scope for v1.
- Revisit: a dedicated chat service only if usage outgrows one-to-one conversations.

## Action Items

1. [ ] Phase 9: spike server-sent events on the TanStack Start server (connection limits, reconnection, behind the reverse proxy).
2. [ ] Phase 9: tests for the authorization rules (non-enrolled student, student of another tenant, student-to-student).
3. [ ] Decide message retention and export or deletion rules in the design doc.
