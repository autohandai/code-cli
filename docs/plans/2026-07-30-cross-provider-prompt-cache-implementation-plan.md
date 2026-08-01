# Cross-Provider Prompt Cache Stabilization — Implementation Plan

**Date:** 2026-07-30
**Status:** Change-scoped validation complete behind a default-off experiment; live proof pending
**Companion:** [Design](./2026-07-30-cross-provider-prompt-cache-design.md)
**Broader roadmap:** [2026-07-23 cross-provider plan](./2026-07-23-cross-provider-prompt-caching-plan.md)

## Delivery Strategy

Implement the smallest safe vertical slice first. Provider KV cache entries cannot move across vendors, so the client responsibility is stable prompt construction and session-level affinity—not pretending a provider switch has a cache hit.

The external `pi-cache-optimizer` package informed the strategy (stable request prefix and provider-safe cache controls), but is not added as a runtime dependency. Its behavior is small, request-path-specific, and must be integrated with Autohand's session lifecycle and typed provider contracts. A native implementation avoids a new dependency and preserves clear ownership.

## Work Items

### 1. Add cache request and usage contracts

- Add a typed optional `promptCache` directive to `LLMRequest`.
- Add optional cache read/write token counts to `LLMUsage`.
- Extend usage normalization with explicit OpenAI Chat and Responses dialects.
- Tests first: usage normalization preserves valid cache counts and ignores malformed/missing fields.

### 2. Add rollout and identity safety rails

- Register `prompt_caching` as a restart-free experiment at `features.promptCaching`, default off.
- Require local opt-in; remote flags cannot enable the local feature.
- Honor a separately named, non-user-overridable remote `prompt_caching_controls_kill_switch`.
- Hash the high-entropy session ID with a domain-separated SHA-256 digest before provider disclosure.
- Tests first: default off, explicit local opt-in, opaque stable identity, and remote kill behavior.

### 3. Derive session affinity at agent completion boundaries

- Add a small pure helper that maps a session ID to an opaque cache key.
- Obtain the current session from the existing `SessionManager` dependency on `AgentReactLoopHost`.
- Attach the directive to normal ReAct and SimpleChat completions while a current session exists and the experiment is enabled.
- Exclude internal exhaustion-summary requests from the agent-turn namespace.
- Do not use provider/model values in the key, so model/provider switches retain the same logical namespace.
- Tests first: stable key across provider changes and no directive with no active session.

### 4. Add the candidate provider adapter

- In `OpenAIProvider.completeWithResponsesApi`, map the directive to `prompt_cache_key`.
- Do not alter the standard Chat Completions request or unsupported providers.
- Retry once without only `prompt_cache_key` when a pre-output HTTP 400 rejects that exact field.
- Never replay cancellation, partial output, generic invalid requests, or unrelated failures.
- Tests first: Responses request includes the key; normal chat request omits it; exact rejection falls back once; generic errors do not replay.

### 5. Validate and document limits

- Run targeted Vitest suites during development.
- Run full test, lint, build, and proof commands.
- Review the final diff to verify the user-owned `bun.lock` and Tuistory changes are untouched.
- Commit the validated implementation with the required co-author trailer.

### 6. Require live evidence before promotion

- Keep the private ChatGPT OAuth Responses adapter classified as a candidate.
- Run two equivalent live turns with stable prefixes only after live-provider authorization is available.
- Require accepted `prompt_cache_key` requests plus provider-reported cache usage before calling the path supported.
- Keep the experiment default off if the transport does not report a valid cache hit.

## Rollout and Follow-up

Existing configurations remain unchanged because the feature is default off, cache directives are optional, and unsupported providers ignore them. The public OpenAI Responses contract documents `prompt_cache_key`, but Autohand's private ChatGPT OAuth backend remains unverified until live evidence is captured.

The larger July 23 plan remains the release roadmap. Deferred work includes protected per-install HMAC identity and key epochs, the full provider/model/API-mode capability matrix, all-provider adapters, richer retention controls, complete uncached/logical/cost accounting, usage ledger and UI/RPC/ACP/telemetry surfaces, localization, and live-provider harnesses. None of those are implied by this initial slice.

## Validation Record — 2026-08-01

- Prompt-cache, agent-loop, SimpleChat, feature-registry, OpenAI transport, and usage-normalization suites pass.
- `bun run typecheck`, `bun lint`, and `bun run build` pass.
- `bun run proof:build-tuistory` passes all 58 scenarios.
- `bun run proof` reaches the existing aggregate unit-suite blockers before Tuistory: `PostTurnActionCoordinator.test.ts` expects an object without the runtime's existing `sequence` field, and `agent.startup-ui.spec.ts` conflicts with a separate unstaged SimpleChat-classification edit. Neither file/behavior is part of this prompt-cache commit.
- No live provider request was sent. The private ChatGPT OAuth Responses transport remains a candidate, not a verified supported path.
