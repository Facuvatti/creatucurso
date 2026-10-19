# ADR-0013: Agent access for course creation (Agent Auth vs MCP plugin)

**Status:** Accepted: Agent Auth plugin (owner decision, 2026-10-19). Revisit only if a safer option appears.
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

**Option B, the Agent Auth plugin**, by owner decision: its instability is accepted unless a safer option is found. No safer option was found: agents authenticate with their own key pair and short-lived signed JWTs (proof of possession), which is stronger than a bearer token, and per-capability grants with constraints fit the rule that agent-created content is a **draft until the creator confirms**. Each connection is bound to one organization with a creator-level role.

Mitigations for the plugin being a draft standard: pin the exact version, put it behind our own port so it can be replaced, cover the capability handlers with tests, and keep the `mcp` plugin (Option A) as the fallback. The plugin is added to the better-auth configuration (and its four tables to `database/schema.sql`) when Phase 10 starts.

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

1. [ ] Confirm that the agent client the owner will use supports the Agent Auth protocol (the project provides an MCP-based client and a CLI).
2. [ ] Install the `mcp-builder` skill before Phase 10.
3. [ ] Small proof in Phase 10: connect that client to a stub provider using option B and record what works; try option A only if it does not.
4. [ ] Update ADR-0011's schema section with the chosen plugin's tables.

## Sources

- Agent Auth Protocol documentation: https://agentauthprotocol.com
- better-auth Agent Auth plugin and MCP plugin pages (via Context7): `/better-auth/agent-auth-protocol`, `/better-auth/agent-auth`, `/better-auth/better-auth`
