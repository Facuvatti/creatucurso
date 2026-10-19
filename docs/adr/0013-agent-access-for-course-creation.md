# ADR-0013: Agent access for course creation (Agent Auth vs MCP plugin)

**Status:** Proposed (decision in Phase 10, after a small proof with the client the owner uses)
**Date:** 2026-10-19
**Deciders:** Facu

## Context

Creators should be able to create courses with an agent. The owner pointed to the Agent Auth Protocol and asked whether the better-auth plugin is the same thing or something different.

What the documentation says (Context7 sources for `agent-auth-protocol`, `agent-auth` and better-auth):
- **Agent Auth Protocol:** an open standard (spec `v1.0-draft`) that gives each AI agent its own identity: a cryptographic key pair, granted **capabilities** (named actions, optionally with constraints such as a maximum amount), approvals by the user, a lifecycle (active, expired, revoked, reactivated), and short-lived signed JWTs. Agents act in `delegated` mode (on behalf of a user) or `autonomous` mode. A **client** (an MCP server, CLI or SDK) holds the host identity and exposes protocol tools to AI systems; the **server** (our platform) is the provider.
- **`@better-auth/agent-auth` plugin:** the server-side implementation of that protocol for better-auth. It lets us define capabilities, set the approval strength, and handle execution in an `onExecute` callback; it can build capabilities from an OpenAPI spec or an MCP server. Its schema adds four tables: `agentHost`, `agent`, `agentCapabilityGrant`, `approvalRequest`. better-auth's own page warns that it implements a standard under heavy development, is not yet stable and may change.
- **`@better-auth/mcp` plugin:** a different mechanism. It makes our app an OAuth 2.1 authorization server and protected resource for **Model Context Protocol** clients (built on the OAuth Provider plugin). `mcp()` and `oauthProvider()` must not both be registered.

So the protocol and the Agent Auth plugin are the same thing at two levels (specification and implementation). The MCP plugin is a separate way to authorize MCP clients with OAuth.

## Decision

No choice yet. Both fit the rule that agent-created content is a **draft until the creator confirms**, and both must bind each connection to one organization with a creator-level role.

## Options Considered

### Option A: MCP server protected by the better-auth `mcp` plugin (OAuth)
**Pros:** standard OAuth flow that MCP clients already know how to follow; the plugin is part of better-auth's regular documentation; build the server with Anthropic's `mcp-builder` skill.
**Cons:** the token represents the user's access, so limits such as "at most N lessons" are enforced by our own code; the organization must be chosen by the tool arguments or at consent time.

### Option B: Agent Auth plugin
**Pros:** per-agent identity, per-capability grants with constraints, approval strength, revocation and auditing by agent; matches our drafts-only rule naturally.
**Cons:** documented as unstable; clients must speak the Agent Auth protocol (the project provides an MCP-based client and CLI), and the support level in the owner's agent client is unverified.

### Option C: Both
More surface to secure and maintain; considered only if A works for current clients and B is needed for richer control later.

## Trade-off Analysis

A is the safer starting point because of stability and existing client support; B offers better control per agent but is a draft standard. The decision depends on which agent client the owner uses and how it connects.

## Consequences

- The database schema gains tables when a plugin is added (ADR-0011): either the OAuth provider tables or the four Agent Auth tables.
- Whatever is chosen, the tools reuse the Phase 3 course service and zod schemas, store drafts only, rate-limit per connection and log every write.

## Action Items

1. [ ] Ask the owner which agent client will be used for course creation.
2. [ ] Install the `mcp-builder` skill before Phase 10.
3. [ ] Small proof in Phase 10: connect that client to a stub with option A and, if supported, option B; record what works.
4. [ ] Update ADR-0011's schema section with the chosen plugin's tables.

## Sources

- Agent Auth Protocol documentation: https://agentauthprotocol.com
- better-auth Agent Auth plugin and MCP plugin pages (via Context7): `/better-auth/agent-auth-protocol`, `/better-auth/agent-auth`, `/better-auth/better-auth`
