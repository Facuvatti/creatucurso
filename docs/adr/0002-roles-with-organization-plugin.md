# ADR-0002: Creators, tutors and students with the better-auth Organization plugin

**Status:** Proposed (items marked "to prove" are covered by Phase 2 tests)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

The platform has two kinds of people: creators (tenants) and students of those creators. Tutors are added later by a creator to specific courses. One person can be a student of several creators, a tutor, and a creator at once, and login is centralized (ADR-0001), so there is a single global identity per person.

Verified in the better-auth documentation:
- `organization({ ac, roles })` accepts custom roles built with `createAccessControl(statement)` and `ac.newRole({...})`.
- `allowUserToCreateOrganization` accepts a boolean or an async function of the user.
- Invitations exist (`sendInvitationEmail`), and lifecycle hooks exist (`organizationHooks.beforeAddMember`, `beforeAcceptInvitation`, and others).
- A member can hold multiple roles.

Not shown in the retrieved documentation and therefore to prove with a test against the installed version: the exact signature of the server-side add-member call, and whether custom `roles` replace or extend the default `owner` / `admin` / `member`.

## Decision

Model tenancy with the Organization plugin:

| Concept | Representation |
|---|---|
| Creator (tenant) | `organization`; `slug` is the subdomain |
| Creator staff | member with `owner` / `admin` |
| Tutor | member with custom `tutor` role, invited by the creator |
| Student | member with custom `student` role, added server-side after a successful payment |
| Course scope of a tutor | `course_tutor (courseId, userId)` table, because organization roles are not per course |
| Course access of a student | `enrollment` table; membership only says "belongs to this creator" |

Rules:
1. Define the access-control statement and the four roles (`owner`, `admin`, `tutor`, `student`) explicitly. The default `member` role is not used. The permission list per role is written in the Phase 1 design doc.
2. `allowUserToCreateOrganization` is a function of the user only, so it checks a creator capability stored on the user (set during creator onboarding), not the request. Students and tutors never get it implicitly.
3. Students are added by server code after the signed payment webhook (idempotent on payment id), never from a client call. A `beforeAddMember` hook rejects any role other than `student` / `tutor` on non-owner paths.
4. The tenant is resolved from the request host (ADR-0001), never from `session.activeOrganizationId`; every request then checks membership in that organization.

## Options Considered

### Option A: Organization plugin with custom roles (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low to medium |
| Cost | Low |
| Scalability | Good (one membership row per student per creator) |
| Team familiarity | Medium |

**Pros:** invitations, roles, permission checks and lifecycle hooks come with the library; one global identity per person.
**Cons:** roles are organization-wide, so course-level scoping for tutors needs our own table; very large student counts per organization make member listing queries something to watch.

### Option B: Own `tenant_student` tables, Organization plugin only for creators
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Low |
| Scalability | Good |
| Team familiarity | High |

**Pros:** students never enter the auth model; leaner membership table.
**Cons:** we rebuild roles, checks and invitations for students and tutors, and lose one consistent permission model.

### Option C: Separate user pools (one auth instance for creators, one for students)
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | Medium |
| Scalability | Good |
| Team familiarity | Low |

**Pros:** hard separation of identities.
**Cons:** a person who is both a creator and a student needs two accounts; contradicts the single central login.

## Trade-off Analysis

Option A reuses the most library functionality at the cost of one extra table for course-scoped tutors. Option B keeps students out of auth but reimplements what the plugin already provides. Option C breaks the single-identity requirement.

## Consequences

- Easier: invitations for tutors, consistent permission checks, one account per person across creators.
- Harder: course-level tutor permissions must be checked in our own service layer in addition to the organization role.
- Watch: membership list queries and indexes as the student count per tenant grows.
- Revisit: Option B only if listing students at scale proves to be a bottleneck.

## Action Items

1. [ ] Phase 2: test the server-side add-member call and the role-extension behavior against the installed better-auth version.
2. [ ] Phase 2: test that a student cannot create an organization and that a student of tenant A is rejected on tenant B.
3. [ ] Phase 1 design doc: permission statement and per-role permissions.
4. [ ] Phase 2: creator onboarding sets the creator capability that `allowUserToCreateOrganization` reads.
