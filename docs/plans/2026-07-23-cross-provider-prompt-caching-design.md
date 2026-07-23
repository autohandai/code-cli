# Cross-Provider Prompt Caching — Design

**Date:** 2026-07-23

**Status:** Proposed for implementation

**Scope:** All built-in, custom, and extension LLM provider paths
**External contract snapshot:** 2026-07-23

## Executive Summary

Autohand should implement provider-side prompt caching as a first-class runtime capability. The feature must reduce repeated prompt cost and latency where a provider supports it, while preserving current behavior everywhere else.

This is not a local cache of token strings, model outputs, or provider responses. Autohand will continue sending the logical conversation. Provider adapters will add only documented cache hints, affinity identifiers, or cache breakpoints, and providers will decide whether a prefix can be reused.

The design has six cooperating layers:

```text
canonical session lifecycle
        ↓
PromptCacheCoordinator (policy, opaque identity, epochs)
        ↓
stable prepared prompt + canonical internal signatures
        ↓
LLMRequestExecutor (IDs, dispatch state, retry budget, ledger)
        ↓
provider/model/API-mode cache adapter
        ↓
normalized usage + cost + per-request usage ledger
        ↓
session totals, diagnostics, TUI, CLI, RPC/ACP/mobile surfaces
```

The implementation will ship in stages. Usage parsing and diagnostics come first without changing request payloads. Cache controls then roll out behind an emergency feature gate for provider/model/API-mode combinations that have unit fixtures and live two-turn proof. Extended retention always remains explicit opt-in.

## Decision Summary

| Decision | Contract |
|---|---|
| Cache ownership | The agent lifecycle owns cache identity and policy; provider adapters only translate the normalized contract. |
| Capability granularity | Resolve by `provider × endpoint/API mode × model`, never by provider name alone. |
| Initial request behavior | Observe-only first; cache hints are experimental and allowlisted. |
| User policy | `mode: off \| auto`; `retention: provider-default \| extended`. |
| Meaning of `off` | Autohand sends no cache hints or stable affinity. Providers may still perform automatic caching. |
| Default retention | Provider default. Extended retention is never automatic. |
| Provider cache key | HMAC-derived opaque value; raw session IDs, paths, prompts, accounts, and credentials are never encoded into the key. The scoped derived key is provider-visible and linkable within that cache scope. |
| Usage compatibility | Existing `promptTokens` remains the complete logical prompt size. Cache fields are additive and optional. |
| Unknown metrics | Missing cache fields mean unknown or unsupported, never a fabricated zero. |
| Persistence | Append one versioned record per dispatched logical request owned by a persisted session; retain `metadata.usage` as an atomic fast aggregate. Sessionless helpers remain in-memory only. |
| Prefix stability | Preserve existing wire-level tool/schema behavior; canonical internal signatures and prefix revisions make changes explicit cache epochs. |
| Support claims | A provider/API mode is “supported” only after payload fixtures and live provider evidence. |
| Failure behavior | Reserve one pre-output fallback for a verified cache-field rejection. Cancellation, partial output, generic errors, and unrecognized failures preserve their existing semantics and are not replayed. |
| Response caching | Out of scope. Agent turns must always produce a fresh model response. |

## Problem Statement

The agent repeatedly sends a large stable prefix:

- product and safety instructions;
- workspace instructions and active skills;
- tool definitions and JSON schemas;
- prior conversation and tool results.

Several supported providers can reuse that prefix, but the current runtime neither controls nor observes prompt caching consistently.

Current gaps include:

- `LLMRequest` has no cache policy, request purpose, stable affinity, or cache breakpoint contract;
- `LLMUsage` only exposes prompt, completion, and total tokens;
- `normalizeLLMUsage` drops nested cache-read and cache-write fields;
- provider request builders send no documented cache hints;
- the model-catalog updater validates cache prices, but runtime normalization drops all price metadata;
- session metadata cannot distinguish uncached input, cache reads, cache writes, or partial reporting;
- streaming clients in several provider families discard terminal usage events;
- the current tool-selection cache only memoizes selected tool names locally and is unrelated to provider prompt caching;
- session usage counters are not consistently reset or hydrated across create, clear, resume, attach, fork, and clone;
- fork and clone currently copy parent usage aggregates;
- current UI surfaces cannot distinguish a cache miss from a provider that does not report cache usage.

Adding only a `cachedTokens` field would leave the important reliability problems unsolved. The feature requires a coherent request, lifecycle, accounting, persistence, and evidence contract.

## Goals

1. Reduce repeated prompt latency and billable input where supported.
2. Preserve byte-equivalent provider serialization for an identical prepared
   request when cache optimization is disabled, relative to the separately
   baselined OpenRouter response-cache safety fix.
3. Support every current provider path with one of four honest states:
   - controlled and measured;
   - automatic and observed;
   - observed opportunistically;
   - unsupported or unobservable.
4. Keep current token totals and context-window behavior backward-compatible.
5. Make cache behavior visible without implying savings that were not reported.
6. Preserve session behavior across terminal, command, RPC, ACP, browser, mobile, subagent, resume, fork, and clone paths.
7. Prevent new cache identities or prompt-derived cache metadata from leaking
   into sessions, logs, sync, telemetry, reports, or exports. Normal prompt,
   transcript, hook, and provider traffic retains its existing documented paths.
8. Fail open when a provider rejects optional cache controls.
9. Make provider support testable through deterministic fixtures and live probes.
10. Keep the implementation modular enough to add future provider cache dialects without broad agent changes.

## Non-Goals

- Storing provider KV tensors or token arrays locally.
- Caching final model responses.
- Guaranteeing a cache hit, price reduction, or specific eviction time.
- Manually purging a provider cache when the provider has no purge API.
- Sending undocumented request fields to “OpenAI-compatible” endpoints.
- Treating local backends as billable providers.
- Enabling extended retention by default.
- Optimizing every auxiliary one-shot LLM call before the main agent path is proven.
- Changing model output, sampling, tools, permissions, or response parsing semantics to chase cache hits.
- Claiming production support from mock tests alone.

## Pi Reference and Deliberate Differences

[Pi's coding-agent and AI packages](https://github.com/earendil-works/pi/tree/9b3a2059171bcc74ad9d2cadeea6d186776cf2db/packages)
demonstrate the useful end-to-end shape: the AI layer carries separate input,
output, cache-read, cache-write, and cost fields; request options carry session
identity and cache retention; adapters translate those options into OpenAI,
Anthropic-compatible, Google/Vertex, Bedrock, Mistral, and compatible-provider
mechanisms; the coding-agent session aggregates the values and renders `R`, `W`,
and `CH` in its footer. It also protects prefix reuse when dynamically loading
tools and disables caching for one-shot compaction work.

Autohand should reuse those product lessons, not copy the contract blindly:

- Autohand keeps its existing `promptTokens` semantics rather than adopting Pi's
  different input-bucket definition.
- Autohand sends an HMAC-derived opaque cache identity instead of its raw persisted
  session ID.
- Missing provider cache fields remain absent rather than becoming zero-filled
  convenience counters.
- Capability resolution includes provider, endpoint/API mode, model, and
  streaming transport.
- Request-level ledgering and canonical lifecycle transitions cover terminal,
  RPC, ACP, browser, mobile, fork, clone, and resume.
- A control is not promoted from implementation fixtures alone; current live
  evidence is part of the support contract.

This lets Autohand retain Pi's strong user-visible accounting while tightening
privacy, partial-reporting correctness, transport parity, and release evidence.

## Terminology

### Logical prompt tokens

The complete provider input represented by the request, including uncached input, cache reads, and cache writes.

### Uncached prompt tokens

Tokens processed normally during this request.

### Cache-read tokens

Tokens whose provider-side prefix state was reused.

### Cache-write tokens

Tokens written into a provider-side cache during this request. Writes are not hits and may cost more than ordinary input.

### Cache hint

An optional field such as `prompt_cache_key`, `session_id`, `cache_control`, or `cachePoint` that improves routing or marks a reusable prefix.

### Cache epoch

A local generation counter representing the current stable-prefix domain. A discontinuity increments the epoch and derives a new opaque provider key.

### Observe-only

Autohand parses cache metrics if the provider returns them but does not alter the request to encourage caching.

## Compatibility Invariants

These invariants are release blockers. The three-way prompt equation applies only
when the provider reports a complete cache breakdown:

```text
promptTokens   = uncachedPromptTokens + cacheReadTokens + cacheWriteTokens
componentTotal = promptTokens + completionTokens
cacheHitRate   = cacheReadTokens / promptTokens
```

- A valid provider-reported `totalTokens` remains authoritative for backward
  compatibility. Derive it from `componentTotal` only when the provider omits it.
  Record a provider/component discrepancy in usage integrity rather than silently
  rewriting either value.
- The three-way prompt equation must hold whenever `cacheMetricsStatus` is
  `reported`. A `partial` response must keep missing buckets absent and must not
  claim a complete decomposition.
- `promptTokens` remains the logical prompt total used by current context, goal-budget, status, and activity calculations.
- `cacheReadTokens` and `cacheWriteTokens` are subsets of `promptTokens`, not additional context.
- Reasoning tokens remain a subset of completion tokens when the provider reports them that way.
- Missing cache fields stay absent. A reported zero remains distinguishable from “not reported.”
- Cache metrics may be partial even when ordinary token totals are complete.
- Cache-read tokens still count toward context occupancy and any provider rate limits that count logical input.
- A cache key is a routing/cache hint, not an idempotency key.
- A verified cache-field rejection before usable output receives one reserved
  cache-free fallback. No stronger guarantee is made for generic errors,
  cancellation, partial output, or budget exhaustion.
- Existing custom and extension providers remain source-compatible because every new request and usage field is optional.

## Proposed Configuration

```typescript
interface PromptCachingSettings {
  /** Controls Autohand-supplied hints. Providers may still cache automatically. */
  mode?: 'off' | 'auto';
  /** Ask for provider default or a verified displayed TTL up to 24 hours. */
  retention?: 'provider-default' | 'extended';
  /** Show cache read/write/hit-rate metrics when reported. */
  showMetrics?: boolean;
  /** Show significant cache-miss notices. */
  showMissNotices?: boolean;
}

interface AgentSettings {
  promptCaching?: PromptCachingSettings;
}
```

Resolution order:

1. non-user-overridable remote
   `prompt_caching_controls_kill_switch` emergency disable;
2. local experimental `prompt_caching` gate at
   `features.promptCaching`;
3. project-local `agent.promptCaching` override;
4. global `agent.promptCaching`;
5. rollout default.

The local feature ID and remote kill-switch ID are intentionally different. The
current feature registry gives local definitions precedence over same-ID remote
flags, so reusing one ID would make the emergency control ineffective.

Initial rollout defaults:

```text
local feature gate: experimental, disabled
remote kill switch: absent/false
mode: auto when the gate is enabled
retention: provider-default
showMetrics: true
showMissNotices: false
```

`mode: off` means Autohand omits cache hints, affinity, and explicit breakpoints. It does not promise that OpenAI, Azure, DeepSeek, Gemini, or another provider will disable automatic caching. Disabling controls also cannot purge entries already held by a provider.

The emergency kill switch, local gate, and `mode: off` disable request mutation only. Provider usage
parsing remains active so rollback does not erase billing evidence or make a
provider-managed automatic cache look unsupported.

Local `mode: off` applies to the next request. The remote emergency state refreshes
at startup and in the background at least every 60 seconds while the agent is
active; it takes effect on the first request after the next successful bounded
refresh. It never adds a network call to an LLM request.

`retention: extended` requests a verified, displayed effective TTL for the
selected capability cell, capped at 24 hours. It never means an unbounded or
future “longest available” policy. An unsupported request downgrades to
provider-default and surfaces an explanatory capability state; it must not fail
the model call.

A project-local setting may tighten a global retention choice. It may elevate
from provider-default to extended only after explicit user approval in that
project; shallow file precedence alone cannot increase remote retention.

Because local project agent settings are currently shallow-merged, prompt-caching settings require an explicit nested merge so a project override does not erase unspecified global values.

## Core Runtime Contracts

### Request purpose

Every `llm.complete()` call must declare why it exists:

```typescript
type LLMRequestPurpose =
  | 'agent'
  | 'subagent'
  | 'compaction'
  | 'final-summary'
  | 'suggestion'
  | 'memory'
  | 'skill-generation'
  | 'utility';
```

Purpose prevents an auxiliary summary or suggestion from silently sharing the primary conversation namespace.

### Normalized cache request

```typescript
interface PromptCacheRequest {
  mode: 'off' | 'auto';
  retention: 'provider-default' | 'extended';
  cacheKey?: string;
  epoch: number;
}

interface LLMRequest {
  // Existing fields remain unchanged.
  purpose?: LLMRequestPurpose;
  promptCache?: PromptCacheRequest;
}
```

Only the opaque `cacheKey`, selected retention, and epoch cross into provider code. Raw session identity and prefix content remain lifecycle concerns. `purpose` remains optional for extension compatibility; every internal Autohand call site must set it explicitly. An omitted purpose resolves to `utility` with cache controls disabled.

### Usage

```typescript
type CacheMetricsStatus = 'reported' | 'partial' | 'not-reported' | 'not-supported';

interface LLMUsageCost {
  currency: 'USD';
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  status: 'reported' | 'calculated' | 'minimum' | 'unavailable';
  source: 'provider' | 'catalog' | 'mixed';
  catalogRevision?: string;
  componentStatus?: Partial<Record<
    'input' | 'output' | 'cacheRead' | 'cacheWrite',
    'reported' | 'calculated' | 'minimum' | 'unavailable'
  >>;
  rateProvenance?: Partial<Record<
    'input' | 'output' | 'cacheRead' | 'cacheWrite',
    string
  >>;
}

interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  uncachedPromptTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteShortTokens?: number;
  cacheWriteLongTokens?: number;
  cacheMetricsStatus?: CacheMetricsStatus;
  integrity?: 'consistent' | 'provider-discrepancy' | 'partial';
  cost?: LLMUsageCost;
}
```

TTL-specific write fields prevent irreversible flattening of Anthropic-compatible billing. Optional cost fields distinguish unknown price from explicitly free or zero-cost usage, while currency, catalog revision, source, component confidence, and rate provenance keep mixed evidence honest.

### Capability descriptor

```typescript
type UsageDialect =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic'
  | 'bedrock-converse'
  | 'deepseek'
  | 'google-native'
  | 'generic';

interface PromptCacheCapabilities {
  automatic: boolean;
  affinity:
    | 'none'
    | 'openai-prompt-cache-key'
    | 'openrouter-session-body'
    | 'gateway-session';
  breakpoints:
    | 'none'
    | 'openai-explicit'
    | 'anthropic-content-blocks'
    | 'bedrock-cache-points';
  retention: readonly ('provider-default' | 'extended')[];
  usageDialect: UsageDialect | 'none';
  reportsRead: boolean;
  reportsWrite: boolean;
  transportEvidence: {
    streaming: 'verified' | 'candidate' | 'unsupported';
    nonStreaming: 'verified' | 'candidate' | 'unsupported';
  };
  minimumCacheableTokens?: number;
  effectiveExtendedTtlSeconds?: number;
  verification?: {
    artifactId: string;
    verifiedAt: string;
    expiresAt: string;
  };
}
```

Capabilities are orthogonal: OpenRouter can combine session affinity with
Anthropic content breakpoints, while OpenAI can combine keyed affinity with
explicit breakpoints. A singular mechanism enum cannot represent these valid
combinations.

Capability resolution must include endpoint/API mode and model. A provider-wide boolean is explicitly prohibited.

Request mutation uses a dated explicit allowlist of provider, endpoint class, API
mode, and model family. Do not infer support from a version-like model string
alone. Usage parsing may be broader when it is non-mutating and preserves unknown
semantics.

An expired verification makes the runtime cell observe-only; it does not merely
block a future release. Live probes may exercise candidate controls only through
an explicit probe-only override that is unavailable to ordinary agent requests.

Remote catalog data may select only strictly validated enum values. It may not inject arbitrary headers, request fields, URLs, or cache keys.

## PromptCacheCoordinator

A focused `src/core/agent/PromptCacheCoordinator.ts` will own:

- canonical session activation;
- user policy resolution;
- opaque provider-key derivation;
- provider, endpoint, API-mode, account-scope, and model-domain isolation;
- request purpose and subagent namespaces;
- cache epochs and discontinuities;
- stable tool/schema signatures;
- session-local provider downgrades with a bounded expiry;
- cache diagnostics.

Provider classes must not keep mutable session cache state. Each request receives a complete cache context.

## Instrumented Request Executor

All primary and auxiliary calls cross one agent-owned `LLMRequestExecutor` before
the provider. It owns the logical request ID, transport-attempt IDs, dispatched
versus failed-before-send state, partial/usable output state, applied cache-control
record, shared attempt budget, terminal usage normalization, and ledger append.

The executor wraps an `LLMProvider` once during dependency composition, so helper
call sites cannot bypass instrumentation. Existing extensions remain compatible,
but request controls and bounded fallback stay disabled for an extension that does
not explicitly advertise the relevant capability and attempt-budget awareness.

### Opaque key derivation

Autohand will create a random 32-byte installation secret with filesystem mode `0600`, stored outside session data and excluded from sync. The key is derived with HMAC-SHA-256 from a versioned tuple:

```text
version
provider namespace
endpoint origin
API mode
model cache domain
opaque local account-scope discriminator, when safely available
canonical persisted session ID
request scope/purpose
cache epoch
```

The account-scope discriminator is locally derived without retaining or sending
a raw account identifier. If a provider path cannot establish one safely, the
endpoint/provider scope remains the isolation boundary and the capability must
not promise stronger cross-account separation.

The secret lives below the resolved Autohand home in a dedicated local-only
prompt-cache state directory. Creation is atomic and race-safe. The loader rejects
symlinks, unexpected ownership where the platform exposes it, permissive POSIX
modes, truncated/corrupt secrets, and non-regular files. Any validation, access,
or platform-permission failure disables Autohand cache hints for that process and
does not block completion. Secret rotation increments the local key version and
invalidates prior cache continuity.

The bounded base64url result is safe for providers with short key limits.

Never include:

- API keys, access tokens, account IDs, or user identity;
- workspace paths, repository names, prompt text, or tool results;
- external RPC/ACP/mobile session IDs;
- device identifiers;
- the raw persisted session ID.

The installation secret, derived keys, and prefix signatures must not be written to logs, sessions, sync payloads, telemetry, exports, shares, or automated reports.

Resume on the same installation re-derives the same key only when durable local
credential-scope continuity is available. Environment-only authentication uses a
process-scoped generation and deliberately sacrifices cross-process cache
continuity rather than derive identity from credential contents. New, clear,
fork, clone, and imported sessions receive new canonical session IDs and therefore
new cache namespaces.

If no persisted canonical session exists, Autohand omits cache hints. Concurrent
sessions remain isolated by their persisted IDs. Resume and attach reuse a key
only when the local-only continuity record confirms the same epoch and prefix
signature; otherwise they rotate conservatively. The continuity record contains
only HMAC-derived opaque identifiers, is permission-protected beside the secret,
and is never synced or exported.

### Canonical session identity

The only canonical input is `SessionManager.getCurrentSession().metadata.sessionId`.

- RPC and ACP IDs map to the persisted session; they are not cache identities.
- Browser startup must not create a second competing persisted session.
- Mobile uses the same persisted session as the agent runtime.
- Auto-mode uses the same persisted session as its agent runtime.
- Concurrent ACP/RPC agents own separate conversation managers; a process-global
  conversation singleton cannot be part of cache identity or context replay.
- Subagents use child-specific random scopes and never reuse the parent session key directly.

### Cache discontinuities

Increment the cache epoch and reset miss diagnostics after:

- provider, endpoint, API mode, account scope, or model-domain changes;
- system/bootstrap prompt changes;
- memory, skill, team, locale, permission-mode, or plan-mode changes that affect the prompt;
- compaction, overflow cropping, smart cropping, undo, or context rebuild;
- MCP/extension/meta-tool registration changes;
- incompatible tool schema or ordering changes;
- resume when canonical context reconstruction differs;
- an exact cache-control rejection that causes a session-local downgrade.

Append-only user, assistant, and tool messages retain the epoch.

## Request Lifecycle

For each primary ReAct request:

1. Resolve the canonical persisted session.
2. Prepare context and apply any compaction/cropping discontinuity.
3. Resolve the actual provider, endpoint/API mode, and model.
4. Select tools through existing behavior and capture their ordered wire snapshot.
5. Recursively canonicalize a copy only for the internal signature.
6. Resolve capability and user policy.
7. Ask `PromptCacheCoordinator` for a per-request cache context.
8. Dispatch through the instrumented request executor.
9. Serialize the provider payload once.
10. Reuse byte-identical cache fields and key through transport retries.
11. Normalize terminal usage immediately.
12. Append one usage-ledger event.
13. Aggregate request usage into turn and session snapshots.
14. Persist the final turn aggregate.

Default purpose policy:

| Purpose | Initial cache policy |
|---|---|
| Primary agent ReAct loop | Provider-default caching when allowlisted |
| Subagent loop | Provider-default with a child-specific namespace |
| Compaction and overflow summary | No Autohand cache hints |
| Final summary | No Autohand cache hints |
| Suggestion generation | No Autohand cache hints |
| Memory extraction/reflection | No Autohand cache hints |
| Skill generation and utility calls | No Autohand cache hints |

Auxiliary scopes can be optimized later only after measurement shows repeatable prefixes and correct accounting.

## Stable Prefix Strategy

Exact-prefix caching only works when the beginning of the serialized request remains stable.

Required rules:

1. Build the system prompt once per cache epoch.
2. Separate stable product instructions from workspace/session-specific content where provider formats permit breakpoints.
3. Preserve the established wire-level tool order and availability; do not freeze,
   reorder, remove, or add tools merely to improve caching.
4. Canonicalize a copy of tool/schema objects for internal signatures without
   changing provider serialization. Any future wire-level canonicalization
   requires its own behavior-equivalence proof.
5. Keep the existing relevance-selection behavior. Any future stable-core policy
   requires separate behavior and tool-availability proof.
6. If `tool_search` or another runtime action exposes tools, preserve the existing
   expansion semantics and bump `prefixRevision` before the next request. Do not
   reuse explicit controls across a changed wire snapshot.
7. Keep volatile user content and changing tool results after stable content.
8. Never add timestamps, random IDs, counters, or transient status to the cacheable prefix.
9. Treat plan-mode, MCP, extension, meta-tool, and permission-surface changes as epoch boundaries.
10. Measure tool-schema tokens removed against cache-prefix tokens lost before changing the current relevance-filtering policy.

Stage 0 and `mode: off` must preserve the current serialized request and headers
for identical input. Internal canonical signatures never authorize a wire change.
If equivalent serialization cannot be proven for a capability cell, omit explicit
controls and remain observe-only.

The current local `toolSelectionCache` remains independent. It may reduce schema volume, but a changing selected-tool list can reduce provider cache hits. Both effects must be measured.

## Provider Capability Matrix

“Support” below describes the intended safe behavior, not a promise that every model in that provider supports caching.

| Provider/API path | Control strategy | Usage strategy | Initial stance |
|---|---|---|---|
| OpenAI API-key Chat Completions | Automatic caching plus stable `prompt_cache_key`; model-gated explicit breakpoints for GPT-5.6+; legacy retention only where documented | `prompt_tokens_details.cached_tokens` and optional `cache_write_tokens` | Controlled after live proof |
| OpenAI ChatGPT OAuth Responses backend | No undocumented public-API fields | Parse Responses-style details if present | Observe-only |
| Azure OpenAI Chat | Automatic caching; add `prompt_cache_key` only for verified API-version/model combinations; no OpenAI explicit breakpoint assumption | `prompt_tokens_details.cached_tokens`; writes remain unknown unless reported | Observe, then allowlist |
| OpenRouter Chat | Stable `session_id` affinity; explicit content-block `cache_control` for routed models that require it | OpenAI-compatible cached/write details | Controlled per routed model |
| LLM Gateway Chat | Verified gateway cache policy and stable session affinity only | OpenAI-compatible cached/write details | Observe, then allowlist |
| DeepSeek Chat | Provider-managed automatic disk cache; no request mutation | `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` | Automatic; observable after live proof |
| Z.ai Chat | Provider-managed automatic cache | Parse documented cached-token details | Automatic; observable after live proof |
| Sakana Chat | No undocumented control; no response-cache feature | Parse cache/orchestration fields opportunistically | Observe-only |
| Custom OpenAI-compatible | Explicit user capability opt-in only | Parse known shapes opportunistically | Conservative |
| Vertex Claude | Anthropic `cache_control` on stable system/tool/message boundaries; 5-minute or verified 1-hour policy | Anthropic input/read/creation fields and TTL split | Controlled after live proof |
| Vertex Gemini OpenAI-compatible | Do not create native CachedContent resources from the current transport | Parse only verified OpenAI-compatible fields | Observe-only pending proof |
| Bedrock Converse | Native `cachePoint` at supported tools/system/message boundaries; model-gated retention | `inputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `cacheDetails` | Controlled after live proof |
| Bedrock OpenAI Chat | Do not map Converse cache points onto this API | Parse compatible details; controls require mode/model proof | Observe-only initially |
| Bedrock OpenAI Responses | Same conservative mode-specific policy | Parse Responses details when present | Observe-only initially |
| xAI Responses | Automatic exact-prefix caching; evaluate only the documented Responses-compatible affinity mechanism for an allowlisted model | `input_tokens_details.cached_tokens` | Observe, then control after live proof |
| Cerebras Chat | Automatic caching on supported requests; evaluate `prompt_cache_key` only on a dated model/API allowlist | `prompt_tokens_details.cached_tokens` | Automatic; key after live proof |
| NVIDIA hosted API | No documented portable cache contract | Opportunistic parsing only | Unknown/observe-only |
| NVIDIA self-hosted NIM | Deployment-admin prefix caching, not a portable request field | Deployment-dependent compatible metrics | Deployment capability |
| Ollama Chat | No portable cache controls or hit accounting for current endpoint | Preserve ordinary prompt/eval counts | Unsupported/unobservable |
| llama.cpp Chat | Server-side reuse is deployment/version dependent | Parse documented cache counters when present | Observe-only first |
| MLX Chat | Server-side reuse/version dependent | Parse cached-token details when present | Observe-only first |
| Extension provider | Provider declares optional capability | Extension returns optional normalized usage | Opt-in only |

### OpenAI API-key path

- Keep automatic caching enabled by preserving exact prefixes.
- Use a stable opaque `prompt_cache_key` for supported public API calls.
- For GPT-5.6 and later, capability-gate `prompt_cache_options` and explicit content breakpoints; older models can reject them.
- Do not assume that “extended” means 24 hours on GPT-5.6+. Current explicit caching uses its own TTL contract.
- Parse Chat Completions and Responses usage dialects separately.
- Preserve `store: false` on the ChatGPT-auth Responses path.

### OpenRouter

- Use the documented top-level request-body `session_id`, enforce its
  256-character limit, and
  fixture its exact placement so a multi-turn session stays on the route holding
  the cache.
- For Anthropic-compatible routes, use explicit block markers rather than top-level automatic caching, because block markers remain portable across direct Anthropic, Bedrock, and Vertex routes.
- Resolve behavior by routed model family, not the provider name `openrouter` alone.
- Explicitly send `X-OpenRouter-Cache: false` to disable the separate OpenRouter
  response cache and fixture that header. Cached responses would violate
  fresh-agent-turn semantics.

### Anthropic-compatible paths

This refers only to verified Anthropic-compatible routes through OpenRouter,
Vertex Claude, Bedrock, or a configured gateway. Autohand does not currently have
a built-in direct Anthropic provider.

- The logical prefix order is tools, system, then messages.
- Use at most the documented number of breakpoints.
- Place breakpoints on stable system content, the final stable tool schema, and the latest cacheable conversation boundary.
- Use one retention class per request to avoid mixed-TTL ordering mistakes initially.
- Parse `cache_read_input_tokens`, `cache_creation_input_tokens`, and the 5-minute/1-hour creation split.

### Bedrock Converse

- Use AWS-native cache points only on models and positions confirmed by the Bedrock capability table.
- Preserve the Bedrock semantic that `inputTokens` is uncached input when cache fields are present.
- Retain `cacheDetails` for TTL-aware cost accounting.
- Cross-region inference may cause additional writes; diagnostics must not label every write as an Autohand prefix bug.

### xAI and Cerebras

- The current xAI adapter uses Responses. Evaluate and fixture the documented
  Responses-compatible cache/affinity field for each allowlisted model. Do not
  send the Chat-specific `x-grok-conv-id` unless the transport itself moves to
  Chat Completions and receives separate proof.
- Cerebras caching remains automatic on supported requests. Add
  `prompt_cache_key` only for a dated model/API capability cell with live proof;
  do not describe it as an account setting Autohand can enable.

### Automatic providers

DeepSeek, Z.ai, Azure, some xAI/Cerebras models, Gemini models, and routed OpenRouter models can cache automatically. Autohand must still:

- keep the prefix stable;
- parse the correct usage dialect;
- avoid claiming that automatic caching can be disabled;
- avoid claiming monetary savings when the provider reports reads but prices them at the ordinary input rate;
- treat an undisclosed TTL as provider-managed.

### Local providers

Local servers may internally reuse prompt state, but local reuse is not equivalent to a billed provider cache. Autohand should show cache metrics only when the endpoint reports them and should not calculate dollar savings for local inference.

## Streaming Usage Corrections

Cache counters commonly arrive only in the terminal streaming event. Apply these
requirements only to adapters/API modes that actually set `stream: true`, and
track streaming and non-streaming evidence separately. Before a streaming path
can be considered complete:

- LLM Gateway-family streaming must preserve terminal usage;
- NVIDIA streaming must preserve terminal usage;
- Cerebras streaming must preserve terminal usage;
- OpenRouter streaming must use correct SSE parsing rather than treating a stream as ordinary JSON;
- Ollama terminal `prompt_eval_count` and `eval_count` must feed normal usage;
- partial/cancelled streams must report usage confidence honestly.

These corrections are prerequisites for provider support claims, not optional cleanup.

## Usage Normalization

Normalization is dialect-aware:

| Dialect | Raw meaning | Normalization |
|---|---|---|
| OpenAI Chat/Azure/OpenRouter | `prompt_tokens` includes reported cached/write subsets | Complete: `uncached = prompt - read - write`; partial: retain unknown buckets |
| OpenAI Responses/xAI Responses | `input_tokens` includes reported cached/write subsets | Complete: `uncached = input - read - write`; partial: retain unknown buckets |
| Anthropic | `input_tokens` excludes cache reads and creation | `prompt = input + read + write` |
| Bedrock Converse | `inputTokens` excludes cache reads and writes | `prompt = input + read + write` |
| DeepSeek | hit and miss are separate | `prompt = hit + miss` |
| Google native | prompt total includes cached subset | `uncached = prompt - cached` |
| Unknown OpenAI-compatible | Semantics unverified | Keep legacy totals; leave cache breakdown absent unless the user selects a validated dialect |

Malformed, negative, non-finite, or internally impossible details must not fail a valid completion. Discard the malformed cache breakdown rather than inventing a corrected value, preserve the ordinary total, and mark cache metrics partial or unavailable.

## Usage Ledger and Session Aggregation

Add an append-only `usage.jsonl` inside each session directory:

```typescript
type PromptCacheDowngradeCode =
  | 'unsupported-retention'
  | 'verified-field-rejection'
  | 'expired-evidence'
  | 'security-state-unavailable';

interface UsageEventV1 {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  logicalRequestId: string;
  transportAttemptIds?: string[];
  turnId?: string;
  timestamp: string;
  provider: string;
  model: string;
  purpose: LLMRequestPurpose;
  cacheEpoch: number;
  outcome: 'completed' | 'partial' | 'failed-after-send';
  usage?: LLMUsage;
  cacheApplication?: {
    requested: 'off' | 'auto';
    applied: boolean;
    affinity?: PromptCacheCapabilities['affinity'];
    breakpoints?: PromptCacheCapabilities['breakpoints'];
    downgradeReason?: PromptCacheDowngradeCode;
  };
}
```

`PromptCacheDowngradeCode` is a closed redacted enum such as unsupported
retention, verified field rejection, expired evidence, or local security-state
failure. Never persist free-form provider error text.

`eventId` is idempotent for a logical usage event. Retries keep one logical
request ID and distinct transport-attempt IDs. The ledger deduplicates replayed
event IDs, serializes same-process writers, uses an inter-process-safe append
strategy, and reconciles a crash between ledger append and aggregate update on
the next load through monotonic `sequence` and
`metadata.usage.lastAppliedSequence`. Append, rotation, sequence assignment, and
aggregate checkpoint share one lock. Lines are size-bounded and redacted before append. A truncated
tail is recoverable. The active file rotates at 8 MiB; retain at most three
rolled segments plus the active file, while `metadata.usage` preserves the
all-time aggregate.

Do not persist a provider key, installation secret, prompt/schema hash, raw request, or raw provider error.

Why a request ledger instead of only attaching usage to assistant messages:

- one user turn can contain many tool-loop requests;
- auxiliary calls may not produce persisted assistant messages;
- a provider response can report usage before a later turn failure;
- retries and partial streams need confidence-aware accounting;
- per-turn and daily diagnostics require timestamps;
- resume must not lose previous cache evidence.

The ledger contains one event for every dispatched logical request owned by a
persisted session. A helper with no canonical persisted session receives no cache
hints and returns usage only to its in-memory caller; it does not invent a session
ledger. Failed-before-send calls are not ledger events.

`metadata.usage` remains an atomic aggregate for fast listing and dashboards. New optional fields include prompt/completion totals, uncached input, cache reads/writes, reporting coverage, request count, last logical prompt size, and cost confidence.

Legacy sessions load without migration failure. Missing cache metadata means unknown. No required field is added to `index.json`.

Preserve the existing `SessionUsageMetadata.tokenUsageStatus` values
`actual | unavailable` for older session, telemetry, and client consumers. Add
optional usage-completeness and cache-reporting fields beside that legacy status;
do not widen or reinterpret it during the initial migration.

Fork and clone copy conversation lineage but start new activity/cache aggregates
and a new ledger. Optional lineage metadata may expose the parent's historical
aggregate separately; it is never added to the child activity total or presented
as newly spent tokens.

## Session Usage Lifecycle Corrections

Before displaying cache data, centralize usage state behind one accumulator with:

- `reset()` for new, clear, fork, clone, and imported sessions;
- `hydrate(metadata.usage)` for resume/attach;
- per-request accumulation;
- per-turn snapshots;
- per-session snapshots;
- separate ordinary-token and cache-reporting status.

This also fixes existing risks where completed-turn totals can be double-counted, live counters can leak across new sessions, resumed live counters restart from zero, and SimpleChat does not update every detailed counter.

The accumulator exposes `beginTurn`, idempotent `recordRequest`, `finishTurn`, and
`abortTurn`. Finishing never adds usage a second time. Aborting retains any usage
already reported as spent. Session close flushes the ledger, checkpoints the
aggregate, performs optional sync, and only then closes.

## Cost Accounting

The runtime model catalog will retain validated optional fields for:

- ordinary input;
- output;
- cache read;
- cache write;
- optional TTL-specific cache-write rates.

Rules:

- absent price means unknown;
- zero means explicitly free, never “missing”;
- local providers can report tokens without a dollar cost;
- a cache hit does not imply savings when cached input has the ordinary input price;
- reported provider cost wins over calculated catalog cost;
- calculated cost records USD currency, catalog revision, rate provenance, and
  component-level rounding before the final display rounding;
- reported and calculated components are not mixed into an apparently exact
  total unless provenance remains explicit;
- timeout/retry ambiguity uses `minimum` or `unavailable` confidence;
- prices are catalog data, not hard-coded constants.

Goal budgets and token activity continue using logical tokens, not discounted cost-equivalent tokens.

## Cache Diagnostics

Diagnostics are local and evidence-based.

For consecutive comparable requests:

```text
expectedReusableUpperBound = min(previousPromptTokens, currentPromptTokens)
possibleMissUpperBound     = max(0, expectedReusableUpperBound - currentCacheReadTokens)
```

Calculate this heuristic upper bound only when:

- the provider reports cache metrics or previously demonstrated cache activity;
- requests share provider/model/API-mode/cache epoch;
- the prefix exceeds the provider/model minimum;
- the difference exceeds a noise floor;
- no compaction, branch, mode, schema, or lifecycle reset occurred.

Never label the bound as exact waste. Exact reusable-prefix loss additionally
requires complete usage, known eligible-prefix boundaries, provider cache-block
granularity, known retention state, and applicable pricing.

Possible observable explanations:

- provider/model changed;
- cache epoch changed;
- idle time exceeded known retention;
- provider routing/control was downgraded;
- provider reported a miss without a locally observable cause.

Do not claim that prompt content changed unless a safe in-memory comparison establishes it. Miss notices default off.

## User-Facing Surfaces

### Status line

Preserve the existing compact format when metrics are absent or the feature is off. When reported:

```text
↑15.7k ↓3.2k R12.4k W1.1k CH79.0% · context 6.0%
```

`↑` remains total logical prompt input. `R` and `W` are subsets of it. `CH` is derived from the latest comparable request, not cumulative lifetime tokens.

### `/usage`

Show:

- logical input/output;
- uncached input when known;
- cache read/write totals;
- reporting coverage;
- latest and session hit rate;
- reported/calculated cost and confidence;
- unsupported/unavailable status without displaying a false 0%.

Rate definitions are distinct:

- request hit rate: complete request cache reads divided by its logical prompt;
- comparable-prefix hit rate: cache reads divided by the eligible reusable-prefix
  estimate when that boundary is known;
- session hit rate: cache reads divided by logical prompt tokens only across
  requests with complete cache reporting, accompanied by reporting coverage.

Do not aggregate partial cache breakdowns into a precise rate.

Activity heatmaps keep using logical total tokens. Add optional cache detail without changing historical buckets.

### `/status` and `/session`

Use the same canonical usage snapshot and formatter. Do not create independently calculated totals.

### Plain and Ink parity

Ink and non-Ink completion summaries must show the same semantics. Preserve the public status-line `metrics` segment and existing string fallback while adding optional structured usage state.

### RPC, ACP, mobile, browser, share, export, hooks, and telemetry

- Preserve existing required fields and add optional structured turn/session usage.
- Do not overload context-estimation APIs with provider usage.
- Standard ACP messages remain standard; Autohand-specific usage uses extension data.
- Mobile/backend consumers must accept optional fields before the CLI emits them.
- Hook environment/JSON fields are additive.
- Share/export can include aggregate cache usage but never cache identity.
- Telemetry remains opt-in and contains aggregated counters/capability state only.

## Privacy and Security

1. Cache controls change remote processing/retention and must be documented as such.
2. Extended retention is opt-in because it may increase residency and write price.
3. Stable product/tool content should be cached before volatile memory, team state, or workspace-specific content where the provider supports breakpoints.
4. Cache keys are scoped to installation, provider, endpoint, API mode, model domain, session, purpose, and epoch.
5. No intentional cross-user, cross-account, cross-provider, cross-model, or
   cross-endpoint key reuse. When account identity cannot be established without
   inspecting environment-only credentials, rotate per process/provider instance
   and forgo resume continuity.
6. Custom endpoints receive no nonstandard control without explicit capability configuration.
7. Raw provider error text is redacted before debug logging when it can echo request fields.
8. Apart from the scoped derived key in its allowlisted provider field, cache
   identities and installation secrets are excluded from session sync, telemetry,
   share, export, bug reports, and support bundles.
9. The secret file is created atomically with restrictive permissions and never committed.
10. Turning controls off is not represented as a provider cache purge or data-retention guarantee.

## Failure and Degradation Rules

- Unsupported provider or model: omit controls; complete normally.
- Unsupported extended retention: downgrade to provider-default and expose capability reason.
- Exact cache-field rejection before usable output: consume the one fallback
  attempt reserved inside the logical-turn budget and retry with cache-only fields
  removed.
- Generic `400`: do not assume cache rejection. Each adapter must match a verified
  provider error code and rejected parameter name.
- Partial stream, usable output, or emitted tool call: never retry merely to strip
  cache controls.
- Cancellation: propagate immediately and do not invoke the cache fallback.
- Timeout after send: do not guess whether a write occurred; cost confidence becomes minimum/unavailable.
- Malformed cache details: keep completion and ordinary totals; mark cache breakdown partial.
- Missing write field: keep write tokens absent, not zero.
- Local off switch: stop emitting controls on the next request.
- Remote kill switch: stop emitting controls on the first request after the next
  successful background refresh, bounded to 60 seconds while online; continue
  parsing usage.
- Provider/model switch: rotate key/epoch; do not share cache state.
- Telemetry/sync schema rejection: keep local feature working and fail soft.

## Rollout

### Stage 0 — Characterize and observe

- Fix usage lifecycle and streaming terminal-usage gaps.
- Add normalized cache fields and usage ledger.
- Exclude active/rolled ledgers, locks, checkpoints, and the local prompt-cache
  secret/continuity directory from sync before writing them.
- Parse provider-reported cache metrics.
- Do not change request payloads.
- Establish baseline hit rate, reporting coverage, error rate, latency, and cost confidence.

### Stage 1 — Opt-in verified controls

- Experimental feature gate, default off.
- Provider-default retention only.
- Enable public OpenAI API-key, OpenRouter documented routes, Vertex Claude, and Bedrock Converse only after live proof.
- Include immediate local off and a 60-second bounded remote kill switch.

### Stage 2 — Expand mode-specific support

- Azure API-version/model allowlist.
- xAI and Cerebras keyed affinity where confirmed.
- LLM Gateway-family and OpenAI-compatible modes only after endpoint fixtures.
- Conservative local/custom/extension reporting.
- Add opt-in miss notices.

### Stage 3 — Default-on short/provider-default optimization

Promote only after at least 7 consecutive days, at least 1,000 eligible repeated
requests overall, and at least 100 requests for every capability cell being
promoted. All thresholds must hold:

- the 95% confidence upper bound on the completion/tool-call failure-rate delta
  is below 0.5 percentage points;
- verified cache-control rejection rate is below 0.1%;
- median eligible repeated-turn latency does not regress by more than 2%, and at
  least one target cohort shows a positive improvement;
- median reported/calculated multi-turn cost does not regress, with coverage
  shown beside the result;
- zero canary findings for secret/key/session-identity leakage;
- each per-mode live artifact is no older than 30 days and is regenerated after
  an API version, transport, or model-family change;
- the kill switch, exact-rejection downgrade, cancellation, and partial-stream
  paths have been exercised.

Rollback request mutation for the affected capability cell immediately if a
50-request rolling window exceeds 1% verified cache-control rejection, completion
failures rise by 0.5 percentage points, median cost rises by 5%, or an identity
leak canary fires. Usage parsing stays enabled during rollback.

These Stage 3 statistics require a separately approved, consented internal-canary
program with a control group, versioned backend aggregate schema, retention
policy, and named Runtime Reliability owner. That program is not created by this
repository plan. Until it exists and produces the thresholds above, this plan may
complete Stage 0 and individually proven Stage 1 cells, but cannot claim default-on
Stage 3 readiness.

Extended retention remains opt-in after Stage 3.

## Test and Evidence Strategy

### Automated tests

- Config parsing/default/round-trip for JSON, YAML, and TOML.
- Stable HMAC key derivation and isolation boundaries.
- Secret-file EACCES, symlink, ownership/mode, concurrency, corruption, and
  rotation behavior on supported platforms.
- Session create/new/clear/resume/fork/clone accumulator behavior.
- Provider payload fixtures for enabled, disabled, supported, and downgraded modes.
- Provider-aware usage fixtures for every dialect.
- Missing-versus-zero and malformed-detail behavior.
- Streaming terminal usage.
- Stable tool/schema serialization.
- Per-request ledger and aggregate migration.
- Cost catalog preservation and confidence.
- Plain/Ink formatter parity.
- RPC/ACP/mobile/share/export/telemetry additive compatibility.
- Canary values proving cache keys, secrets, credential-scope identifiers, and
  prefix signatures never reach logs, sessions, sync, telemetry, hooks,
  share/export, or reports. Raw session IDs, prompts, and paths are tested only
  against new cache metadata, provider cache-key fields, and rendered cache
  errors; their pre-existing legitimate transcript/hook/provider flows are out of
  scope.
- Built CLI Tuistory covering a two-turn reported cache flow and clean exit.

### Live proof

For each claimed provider/model/API mode:

1. Construct a stable prefix at or above the documented minimum.
2. Send two sequential requests with the same logical session identity.
3. Record sanitized payload-field presence, terminal usage, latency, and provider/model/API mode.
4. Repeat at least three times across two fresh opaque cache scopes before the
   first allowlist entry.
5. Enable candidate request controls only through an explicit probe-only override
   that cannot be selected by normal CLI configuration.
6. Require the second request to report a cache read only where the provider contract guarantees an observable read.
7. Record pass, fail, unsupported, unreported, or environment-blocked.
8. Store a sanitized artifact containing provider, endpoint class, API mode,
   model, timestamp, probe version, automatic/affinity/breakpoint capabilities,
   retention request, result,
   usage coverage, and latency. Never store a credential, raw endpoint with
   secrets, raw cache key, prompt, or response body containing user content.
9. Expire the artifact after 30 days or immediately after relevant provider,
   transport, API-version, or model-family change.

Mock-green tests are necessary but insufficient for a production-support claim.

## Acceptance Criteria

- After the separately committed OpenRouter response-cache safety header is
  baselined, feature-off provider serialization is byte-equivalent for an
  identical prepared request.
- Existing `promptTokens`, `completionTokens`, and `totalTokens` semantics remain intact.
- Cache-off golden payload and header fixtures cover every adapter/API mode.
- Every internal `.complete()` call declares a request purpose; an external call
  with no purpose receives no Autohand cache controls.
- Every built-in provider/API path has an explicit capability state and adapter test.
- Custom and extension providers remain compatible and conservative by default.
- Cache keys are opaque, bounded, stable across resume when durable local scope
  continuity exists, and isolated across scope changes. Environment-only auth
  rotates across processes by design.
- Effective credential/account-scope rotation produces a new key without hashing,
  persisting, or transmitting raw credentials or account identifiers.
- New/fork/clone/import sessions do not inherit spent-token aggregates or cache namespaces.
- Provider cache rejection degrades once without losing the completion.
- Missing cache reporting never renders as a 0% hit rate.
- Context occupancy uses logical prompt tokens.
- Cache prices survive model-catalog normalization without converting unknown to zero.
- Status, `/usage`, `/status`, `/session`, Plain, and Ink share one usage snapshot.
- Public protocol changes are additive and version-safe.
- Outside the dedicated permission-protected local secret/continuity store, no
  key, secret, prompt fingerprint, or raw prompt appears in persisted or
  transmitted operational data.
- Security canaries prove cache-only identity values do not enter logs, telemetry,
  sync, share/export, hooks, or automated reports, and prove raw session/prompt/
  path values are not newly copied into cache metadata or cache errors.
- Every production support claim has current live evidence.
- Unsupported, custom, and extension providers remain request no-ops unless an
  explicit validated capability is selected.
- Ink rendering and real PTY/Tuistory cover a two-turn reported cache flow,
  narrow-terminal layout, Plain/Ink parity, Ctrl+C, and clean exit.
- Prompt-cache coordination adds no more than 2 ms p95 local CPU overhead per
  request in the repository benchmark and does not add an extra network call.
- Usage-ledger storage stays within the documented 32 MiB rolling-detail bound.
- Dependency checks retain Ink `>=7` and React `>=19`.
- Tests, lint, typecheck, build, Tuistory, and `CI=true bun run proof` pass.

## STOP Conditions

Stop implementation and resolve the contract before proceeding if:

- a provider field is not documented or proven by an endpoint fixture;
- a change would redefine legacy `promptTokens`;
- a missing metric would be displayed as zero;
- extended retention would become default;
- cache identity would contain or expose raw local/user data;
- a remote catalog could inject arbitrary request fields;
- an RPC/ACP/mobile/backend schema needs a breaking change;
- a request retry would escape the existing logical-turn attempt budget;
- tool-prefix stabilization would remove a currently working capability;
- production support would be claimed without live provider evidence.

## Primary References

- [Pi coding-agent cache accounting and footer](https://github.com/earendil-works/pi/tree/9b3a2059171bcc74ad9d2cadeea6d186776cf2db/packages/coding-agent)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Azure OpenAI prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching)
- [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [LLM Gateway provider cache control](https://docs.llmgateway.io/features/caching/provider-cache-control)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
- [Vertex Claude prompt caching](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/prompt-caching)
- [Gemini context caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)
- [Amazon Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)
- [Cerebras prompt caching](https://inference-docs.cerebras.ai/capabilities/prompt-caching)
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/)
- [Z.ai context caching](https://docs.z.ai/guides/capabilities/cache)
- [NVIDIA NIM environment controls](https://docs.nvidia.com/nim/large-language-models/latest/reference/environment-variables.html)
- [llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [MLX-LM](https://github.com/ml-explore/mlx-lm)
- [Ollama chat API](https://docs.ollama.com/api/chat)

Provider contracts are time-sensitive. Reverify the relevant primary reference immediately before implementing or promoting each adapter.
