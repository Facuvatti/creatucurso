# System design: multi-tenant course platform

**Status:** Draft for review (Phase 1)
**Date:** 2026-10-19
**Related decisions:** ADR-0001 login handoff, ADR-0002 roles, ADR-0003 payments, ADR-0004/0005 video provider, ADR-0007 messaging, ADR-0008 certificates, ADR-0009 webhook exams, ADR-0010 in-app chat

Items marked **(assumption)** are planning assumptions to confirm; they are not facts.

## 1. Requirements

### Functional
- Creators (tenants) publish courses on a free subdomain (`maria.example.com`) or a custom domain; a tenant has many courses; courses have ordered modules and lessons; course URLs use a title-based slug.
- Public tenant and course pages are server-rendered with per-page metadata for search engines; reviews are public before login or purchase.
- Central login at `app.example.com` with a single OAuth callback; sessions reach tenant hosts through a one-time-token handoff (ADR-0001).
- People are creators, tutors (added by a creator, per course) or students, all on one global account (ADR-0002).
- Students pay creators through Hyperswitch; payment confirmation enrolls the student (ADR-0003).
- Lessons with protected video (Basic: self-hosted encrypted HLS; Premium: provider DRM), moving watermark with the student's identity, deterrence on the player page.
- Reviews (public), lesson comments (enrolled), progress tracking, form exams, webhook-graded exams, certificates with a public share page, tutor-student chat, email automations on enrollment and course completion.
- Creators are billed monthly from measured usage (storage, streaming, DRM licenses), with a configurable margin.
- Agent-driven course creation through an MCP server (drafts only until the creator confirms).

### Non-functional
- SEO: public pages render complete HTML on the server, with title, description, canonical URL and structured data.
- Security: strict tenant isolation, no secrets in the browser, hardened outbound calls (SSRF), safe file uploads.
- Reliability: payment, completion and automation events are never lost or processed twice.
- Operability on one self-hosted server; simple deployment with Docker Compose.
- Targets **(assumption)**: p95 server response under 500 ms for public SSR pages with a warm cache, availability of a single server (no formal SLA in v1).

### Constraints
- One self-hosted ARM server, 16 GB RAM (up to 32 GB). Development happens on a Raspberry Pi 4 with 7.6 GB. No MongoDB.
- TanStack Start with Node, better-auth with the Organization plugin, Postgres without an ORM, Hyperswitch (own compose project).
- Strict TDD; small commits; design patterns only where they pay for themselves.

## 2. High-level design

### Architecture style
A **modular monolith**: one TanStack Start application plus one background worker process built from the same code base, with a Postgres database. Code is organized by domain ("screaming" structure), each module split into `domain` (pure TypeScript rules), `application` (use cases and ports) and `infrastructure` (database repositories and adapters). Routes only translate HTTP to use cases.

```
src/
  modules/
    tenancy/      identity/     catalog/      enrollment/
    payments/     community/    assessments/  media/
    billing/      certificates/ automations/  chat/
      domain/  application/  infrastructure/
  shared/         (result type, ids, clock, errors, upload validator, ssrf guard)
  routes/         (thin: parse, call use case, render)
```

Ports and adapters are used where an external provider is uncertain or replaceable: payments (Hyperswitch), video (VdoCipher, Bunny or a license-only DRM), email. A repository per aggregate always receives the resolved tenant, so a query cannot be written without tenant scope.

#### Modules that can move to their own server
The owner wants each service to be movable to another server when scale requires it. These rules make that possible without paying for microservices today:
1. A module's only public surface is `modules/<name>/api.ts` (its ports). Other modules import nothing else, and a CI check on imports enforces it.
2. Synchronous calls between modules go through those ports. Today the adapter is an in-process call; later it can be an HTTP or queue adapter with no change to the callers.
3. Asynchronous reactions use outbox events, which already travel through a table the worker reads.
4. Each module owns a Postgres schema (for example `catalog`, `enrollment`, `chat`) and reads its connection string from its own environment variable, defaulting to the shared database, so a module's data can move to another Postgres host.
5. No joins and no foreign keys between module schemas, except references to the identity and tenancy tables owned by better-auth (`user`, `organization`), which stay in the `auth` schema as the platform's foundation.
6. Deployable units from day one: `web` (the Start app), `worker`, and `media` (HLS packaging, key server and segment delivery for the Basic tier). They run from the same code base with their own configuration, so any of them can run on a different machine.

External services (Hyperswitch, the video provider, email) are already separate.

No other patterns are introduced up front.

### Components

```
 Browser ──HTTPS──> Reverse proxy (wildcard subdomains + custom domains, TLS)
                         │
                         ▼
              TanStack Start app (Node)  ───────┐
              • global request middleware       │ SQL
                (resolve tenant from Host)      ▼
              • SSR routes + server functions  Postgres
              • /api/auth/* (better-auth)        ▲
              • webhooks in (payments)           │ SQL (outbox, jobs, usage)
              • SSE (chat)                       │
                                                 │
              Worker (Node, same code) ──────────┘
              • outbox dispatcher → automations (email)
              • exam webhook calls (SSRF-guarded egress)
              • usage collection + monthly close

  External: Hyperswitch (own compose) · video provider (TBD) · email provider
```

### Request flow: tenant resolution
1. A global request middleware (`src/start.ts`, `requestMiddleware`) reads the `Host` header and resolves it to a tenant through `tenant_host` (an in-memory LRU with a short time to live, invalidated when a host changes).
2. Known host → the tenant is added to the request context. `app.example.com` → platform context. Unknown host → 404 before any other work.
3. Every use case then checks membership of the logged-in user in that tenant. The tenant is never taken from `session.activeOrganizationId` (ADR-0002). Whether the middleware context reaches route loaders directly or must be re-read with the request helper is verified by a test in this phase.

Example in plain words: `maria.example.com/cursos/python` and `maria-courses.com/cursos/python` both reach the same server. The middleware reads the address the visitor typed (the `Host` header), looks up which creator owns it (subdomain = the organization's slug, custom domain = a column on the organization), and every query during that request is limited to that creator's data. The logged-in person is a separate matter: one student can be logged in and visit many creators' sites, so the creator comes from the address and the person comes from the session.

### Key flows
- **Login on a tenant host:** tenant → `app.example.com/login?return=...` → login → one-time token → tenant `/auth/handoff` → host-only session cookie (ADR-0001).
- **Purchase:** checkout → Hyperswitch → signed webhook → idempotent on the payment id → add student member + `enrollment` + outbox event `enrollment.created`.
- **Completion:** last required lesson/exam → `course.completed` outbox event → certificate issued → automation sends the email.
- **Playback:** access check on enrollment → short-lived token (Basic: HLS key; Premium: provider token) → player with moving watermark.

## 3. Data model

### From better-auth (SQL produced by its `generate` command, kept in `database/schema.sql`)
`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, plus `organizationRole` only if dynamic access control is enabled. Plugins that need tables (for example Agent Auth, ADR-0013) add theirs to the same generated section. `organization.slug` is the free subdomain and `customDomain` is an added column.

### Application tables
Kept to a minimum: closely owned child data lives in JSONB or array columns of its parent instead of separate tables. Identity, tenancy, memberships, invitations and roles use better-auth's own tables; a custom domain is an extra column on `organization`, so no host table is needed.

| Table | Key points |
|---|---|
| `course` | `organization_id`; `slug` unique per organization; `previous_slugs` text[] for 301 redirects; status draft/published; certificate template reference and field positions |
| `module`, `lesson` | ordered; lesson slug unique per course |
| `course_tutor` | `(course_id, user_id)` |
| `enrollment` | `(user_id, course_id)` unique; `payment_id` unique when present; certificate columns (credential id unique and random, status, file, issued at) |
| `lesson_progress` | `(lesson_id, user_id)` unique |
| `review` | `(course_id, user_id)` unique; rating 1 to 5; hidden flag |
| `comment` | lesson, user, optional parent, hidden flag |
| `exam` | settings; questions and answer key in a JSONB column never selected for students; webhook URL and encrypted signing secret for webhook exams |
| `exam_attempt` | exam, user, started and submitted times, answers, score, passed, grading error |
| `automation` | trigger, channel (email in v1), template, enabled; attachments as JSONB |
| `message_delivery` | automation, event, status, attempts |
| `outbox_event` | type, payload, status, attempts; written in the same transaction as the change |
| `tenant_usage` | daily per organization with a cost snapshot |
| `invoice` | monthly invoices |
| `conversation`, `message` | in-app chat (ADR-0010) |

All tenant data carries `organization_id` and every repository query is scoped by it. Postgres row-level security is a possible later defense in depth, not part of v1.

### Storage choices
Postgres 16 or newer accessed with the `pg` driver and hand-written SQL, no ORM. `database/schema.sql` is the single schema file: our tables plus a delimited section with the SQL produced by better-auth's `generate` command (ADR-0011). Files (certificate templates, issued PDFs, attachments, Basic-tier video) on the server's disk behind an interface so object storage can replace it later.

## 4. Deep dive

### Roles and permissions (proposal, to confirm)
| Capability | owner | admin | tutor (assigned courses) | student (enrolled) |
|---|---|---|---|---|
| Manage courses, modules, lessons | yes | yes | no | no |
| Publish a course | yes | yes | no | no |
| Invite or remove tutors | yes | yes | no | no |
| Moderate reviews | yes | yes | no | no |
| Reply to and moderate comments | yes | yes | yes | reply only |
| See exam results | yes | yes | yes | own only |
| Chat | yes | yes | yes | own conversations |
| Configure certificates and automations | yes | yes | no | no |
| Billing and payment settings | yes | no | no | no |
| Read lessons, post review and comments, take exams | n/a | n/a | n/a | yes |

### Events and background work
Domain events are written to `outbox_event` inside the same transaction as the change (enrollment, course completion, exam passed, certificate issued). The worker polls the table with row locking (`FOR UPDATE SKIP LOCKED`), dispatches to handlers, retries with backoff, and each handler is idempotent. Postgres is used as the queue, so no extra service is needed in v1; Redis stays optional (Hyperswitch has its own).

### Caching
- Tenant host lookup: in-memory LRU, short time to live, explicit invalidation.
- Public pages: SSR on each request with `Cache-Control` headers set so the reverse proxy can cache anonymous responses later. Personalized responses are never cached.

### Error handling
- External calls (payments, provider, email, exam webhooks) have timeouts, bounded retries with backoff and a recorded failure state.
- Exam webhook failures are grading errors, never passes (ADR-0009).
- Webhooks received from Hyperswitch are verified by signature and are idempotent.

### Security
- Tenant isolation tests for every use case; per-tenant secrets encrypted with a master key from the environment.
- One SSRF guard module for every outbound call to a user-supplied URL; one upload validator for every file (real type check, size limits, image re-encoding, PDF flattening).
- Session cookies are host-only and `HttpOnly`; handoff tokens are single-use, hashed at rest and very short-lived.

## Course import and export (JSON)

The owner provided an example of the course structure in `docs/formato_curso_por_mcp.md`. The JSON is the public contract for importing a course from the dashboard and for agent access; the importer is one use case in the `catalog` module.

Mapping: `name`, `slug`, `shortDescription`, `longDescription`, `requirements`, `learningGoals` and `targetStudents` belong to the course; `modules[]` hold `classes[]`, which are stored as lessons (`classes` is the external name, `lesson` the internal one).

Rules (proposal, to confirm):
- **Required:** `name`; at least one of `shortDescription` or `longDescription`; at least one module; at least one class in every module; at least one video in every class. Everything else is optional. An empty or absent `slug` is generated from the name; a slug already used in the tenant is an error, never silently renamed.
- **Order:** `order` is optional and defaults to the array position; when present it must be unique among siblings.
- **Strict:** unknown fields are rejected so typos are caught. Errors list the JSON path (for example `modules[1].classes[0].videos[0]`).
- **Limits** (initial): up to 100 modules, 200 classes per module, 10 videos and 20 notes per class, 10 cover images, list items up to 200 characters. The `durationMinutes` field was removed from the format and is rejected like any unknown field.
- **Instructors:** `instructors` are user ids; each must be a member of the same organization with the owner, admin or tutor role, and becomes a `course_tutor` entry.
- **Media references (upload by local path):** `coverImages`, `promoVideo`, `videos` and `notes` hold the local paths, on the creator's computer, of the files to upload, such as `C:/Users/maria/Desktop/curso-web/mod1/clase1.mp4`. The goal is to upload from those paths instead of dragging each file by hand. The server never reads these paths and never treats them as server paths; it only records them as references. Importing creates one **upload slot** per reference (a signed, expiring upload target plus the expected file kind). A **client running on the creator's computer** reads each path and uploads the file to its slot: a small command-line tool, or an agent with file access, can do this directly. A web page cannot read a file from a path written in a JSON (browser security), so in the dashboard the creator selects the course folder once (a folder input, to be verified in Phase 3) and the page matches the selected files to the slots by relative path or file name and uploads them. A course with empty required slots stays a draft and cannot be published.
- **Allowed kinds:** images (WebP, PNG, JPEG), video (MP4, MOV, WebM; transcoded on the server), notes (PDF; ZIP only with size limits, never extracted or executed on the server, to be confirmed).
- **Atomic and idempotent:** the whole import succeeds or nothing is created, always as a draft; repeating the same request with the same idempotency key returns the same result.
- **Export** produces the same format so a course can round-trip.

## 5. Scale and reliability

### Load estimation **(assumption)**
Initial target: tens of tenants, a few thousand students, tens to low hundreds of concurrent lesson viewers. The application servers HTML and JSON, not video, in the Premium tier, so one process on the ARM server is enough for the dynamic traffic; the worker is a second process.

### Basic-tier video bandwidth
The server's upstream is 114 Mbit/s (owner measurement; a load test confirms it). Keeping about 20 percent free for the rest of the traffic leaves about 90 Mbit/s for video. Planning figures:
- 720p at about 2.5 Mbit/s: roughly 35 simultaneous viewers.
- 480p at about 1.2 Mbit/s: roughly 75 simultaneous viewers.

HLS players download in bursts, so real peaks are higher than the average, and these figures are estimates, not measurements. Decision (ADR-0012): the Basic tier continues under these limits with a capped quality ladder, a configurable global cap on simultaneous Basic streams (initial value 30) and a clear "try again later" response beyond the cap. The `media` unit can later move behind a CDN or to another connection. If the load test shows the numbers do not hold, the Basic tier is dropped.

### Encoding on ARM
Encoding HLS with ffmpeg on the ARM server is CPU-heavy; jobs run in a queue with limited concurrency so the app is not starved. Premium providers encode on their side.

### Scaling and failure
- Vertical first (16 GB to 32 GB). Horizontal scaling later means moving server-sent events to Postgres LISTEN/NOTIFY or Redis and files to object storage; the interfaces for both exist from the start.
- Single server means no failover in v1. Mitigations: nightly Postgres backups copied off the machine, a restore test, and health checks.
- Monitoring: health endpoints, structured logs, and alerts on outbox backlog, failed deliveries and failed payments webhooks.

## 6. Trade-offs

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Deployment shape | Modular monolith + worker | Microservices | One small team, one server, strict TDD; boundaries are enforced by modules, not by the network |
| Queue | Postgres outbox with row locking | Redis queue or a broker | No extra service; transactional with the data change |
| Data access | `pg` with hand-written SQL and one `schema.sql` | An ORM | Owner decision; better-auth's `generate` already emits plain SQL for the `pg` setup (ADR-0011) |
| Tenant isolation | `organization_id` scoping in repositories | Schema per tenant, or row-level security | Simplest correct start; row-level security can be added later |
| Chat | In-app on Postgres | OpenIM | No MongoDB; same authorization model (ADR-0010) |
| Files | Local disk behind an interface | Object storage now | No extra service on one server |

## 7. Open questions
1. Load test of the real 114 Mbit/s upstream for the Basic tier (ADR-0012).
2. Final video provider (ADR-0005).
3. Role permission table above: confirm or adjust.
4. Whether students may message each other (assumed no).
5. Required exams: course-level or module-level (assumed course-level).
6. Message retention and deletion rules for chat.

## 8. What to revisit as the system grows
- Move video delivery to a CDN or the provider for all tiers.
- Move files to object storage and chat events to a shared pub/sub layer.
- Add Postgres row-level security if tenant-scoping mistakes appear in review or tests.
- Split the worker by workload (email, exam calls, usage) if one process becomes a bottleneck.
