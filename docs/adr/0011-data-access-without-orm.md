# ADR-0011: Data access without an ORM and a single schema file

**Status:** Accepted (owner decision), with one open point about evolving a database that already has data
**Date:** 2026-10-19
**Deciders:** Facu

## Context

The owner does not want an ORM and wants a single file, `database/schema.sql`, instead of a migration command. Identity, tenancy and roles should use better-auth's own tables, with as few custom tables as possible. The owner also expects services to be movable to other servers later, and believed there was no SQL sample for better-auth's plugin tables.

Verified:
- better-auth accepts a plain `pg` `Pool` as its database (built-in Kysely adapter).
- The `generate` command produces an SQL file for that adapter, and `migrate` applies the schema directly (optional). The documentation says `generate` is meant for applying the schema manually.
- **Experiment (2026-10-19, scratch directory, Postgres 16 in Docker):** with the `organization` plugin (dynamic access control enabled) and the `oneTimeToken` plugin, `generate` produced SQL for 8 tables: `user`, `session`, `account`, `verification`, `organization`, `organizationRole`, `member`, `invitation`. `oneTimeToken` needs no table of its own. So plugin tables do come out as SQL; no manual transcription is needed.
- `organizationRole` is better-auth's table for roles and permissions when dynamic access control is enabled. Static roles defined in code (`createAccessControl`) need no table.
- The `schemaName` option places better-auth's tables in a Postgres schema at runtime, but the generated SQL is not schema-qualified, so the schema file must set the `search_path` before that section.
- The Agent Auth plugin's schema defines four more tables (`agentHost`, `agent`, `agentCapabilityGrant`, `approvalRequest`) that `generate` would emit if the plugin is added (ADR-0013).

## Decision

1. Use the `pg` driver with hand-written SQL in repository functions. Rows are validated with zod at the repository boundary. No ORM, no query builder.
2. `database/schema.sql` is the single source of truth. It has a delimited section holding the SQL produced by `generate` for better-auth (with `CREATE SCHEMA auth` and `SET search_path` around it), followed by our own tables.
3. The `migrate` command is not used. When a plugin is added or changed, `generate` is run and its output replaces the delimited section. A CI check regenerates the SQL in a throwaway database and fails if the section differs.
4. Roles and permissions: static roles in code for v1 (owner, admin, tutor, student); better-auth's `organizationRole` table is used only if dynamic access control is enabled later. Tenancy uses `organization` and `member`; the custom domain is an extra column on `organization`.
5. Our own tables are limited to domain data that better-auth does not model (courses, enrollments, exams, outbox, usage and so on), kept to a minimum with JSONB or array columns for tightly owned child data (see the system design).
6. Tests that touch the database run against a real Postgres in Docker, applying `schema.sql` to an empty database.

## Options Considered

### Option A: pg + hand-written SQL + one schema file (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low tooling, more SQL written by hand |
| Cost | Low |
| Scalability | Good |
| Team familiarity | High for SQL |

**Pros:** no ORM or migration tool to learn or maintain; the whole schema is readable in one file; better-auth's SQL slots in directly.
**Cons:** no compile-time types for queries; destructive changes to existing data need hand-written SQL.

### Option B: Drizzle or Prisma
Rejected by the owner; both would also need a migration workflow.

## Consequences

- Easier: one readable schema; a fresh database is created by applying one file.
- Harder: query typing relies on tests and zod; evolving a live database is manual.
- Revisit: a typed query layer (for example generated types from the schema) if hand-written queries become error-prone.

## Open point

`schema.sql` describes a fresh database. For a database that already has data, changes need `ALTER` statements. Proposal: write `schema.sql` with idempotent statements (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so the same file can be re-applied on deploy, with destructive changes done by hand and noted in the file. Owner to confirm.

## Action Items

1. [ ] Create `database/schema.sql` with the auth section produced by `generate` and verify it applies to an empty Postgres with `search_path` set to the `auth` schema.
2. [ ] CI drift check for the auth section.
3. [ ] Repository helper: connection setup per module (environment variable per module, default to the shared database).
4. [ ] Decide the upgrade approach for databases with data (open point above).
