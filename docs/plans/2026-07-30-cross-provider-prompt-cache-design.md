# Cross-Provider Prompt Cache Stabilization — Design

**Date:** 2026-07-30
**Status:** Implemented behind a default-off experiment; live transport proof pending
**Roadmap:** [Cross-Provider Prompt Caching — Implementation Plan](./2026-07-23-cross-provider-prompt-caching-plan.md)
**Official contract:** [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
**Related research:** [pi-cache-optimizer](https://pi.dev/packages/pi-cache-optimizer), [Prompt Caching In Agents](https://earendil.com/posts/prompt-caching/)

## Problem

Autohand sends an expanding conversation, tool catalog, and system instructions on each agent turn. Providers cache prompt prefixes independently, so changing model providers in a live session cannot transfer a provider's stored KV cache to another provider. The current runtime does not express cache affinity or preserve cache-specific usage metrics, leaving supported provider caches underused and unobservable.

A local response cache is intentionally out of scope: it would alter completion semantics and cannot safely replace provider inference for a mutable agent conversation.

## Goals

1. Preserve a stable logical cache identity across all turns of one Autohand session, including model/provider changes.
2. Send provider-native cache affinity only where the transport explicitly supports it.
3. Keep request behavior identical for unsupported providers and requests without an active session.
4. Normalize provider-reported cache token metrics without inventing cache hits or savings.
5. Keep cache identifiers opaque and free of workspace paths, prompts, account identifiers, and API keys.

## Non-Goals

- Transfer a physical KV cache between providers. Provider KV storage is vendor-local and cannot be migrated by a client.
- Cache model responses locally.
- Reorder or mutate conversation messages, system prompts, or tool definitions solely for caching.
- Add provider-specific cache controls for every provider in this first rollout.
- Estimate cache savings when the provider does not report them.

## Architecture

### Stable prefix remains the primary optimization

Prompt caching depends on an unchanged serialized prefix. Autohand must continue building its system instructions, tool definitions, and prior conversation deterministically. This change does not reorder these elements. It attaches cache metadata after request construction, so the logical conversation remains provider-agnostic.

### Session-owned affinity

Each persisted session already owns a unique `sessionId`. The runtime derives an opaque, deterministic cache key from that ID:

```text
ahpc_<base64url-sha256("autohand-prompt-cache:v1\\0agent\\0" || sessionId)>
```

The key represents a logical conversation namespace, not a provider namespace. A provider switch retains the same key. The new provider begins with an empty provider-side cache, but subsequent turns sent to that provider retain affinity. Returning to a prior provider allows that provider to associate the conversation with its existing cache, subject to its retention policy.

The raw session ID is never sent to a provider. The key is deliberately not stored in config or session metadata. It is reproducible from the high-entropy session ID and contains no user/workspace/prompt data. A protected per-install HMAC secret and explicit key epochs remain part of the broader roadmap before this is promoted beyond the default-off experiment.

### Typed request contract

`LLMRequest` gains an optional `promptCache` directive:

```ts
interface PromptCacheDirective {
  key: string;
}
```

The directive is constructed for normal ReAct and SimpleChat agent turns. Internal exhaustion-summary requests are intentionally excluded so unrelated request purposes do not share affinity. Providers that do not support the directive ignore it. This keeps extension and custom provider contracts source-compatible.

### Rollout controls

The local `prompt_caching` experiment (`features.promptCaching`) defaults to off and is the required user opt-in. A separately named, non-user-overridable remote `prompt_caching_controls_kill_switch` can disable request mutation without granting the server permission to enable it. The decision is made locally at request time and does not fetch flags on the request path.

### Initial provider adapter

The OpenAI ChatGPT OAuth Responses transport is the first candidate adapter. It maps `promptCache.key` to the public Responses API's documented `prompt_cache_key` body field. Autohand's OAuth transport targets a private ChatGPT backend, however, so support is not promoted as verified until a current two-turn live probe succeeds. If that backend returns a pre-output HTTP 400 identifying that exact field as unknown or unsupported, the adapter retries once without only that field. It never retries cancellation, partial output, generic invalid requests, or unrelated errors.

Standard OpenAI Chat Completions remain byte-compatible and do not receive the Responses-only field. Other providers remain no-ops until each endpoint/model/API mode has a documented contract, serializer tests, and live proof.

### Cache usage accounting

`LLMUsage` adds optional `cacheReadTokens` and `cacheWriteTokens`. `normalizeLLMUsage` selects the provider dialect explicitly: Responses reads `input_tokens_details`, while Chat Completions reads `prompt_tokens_details`. Only non-negative safe integers are accepted. An impossible cache breakdown larger than the logical prompt is discarded without discarding ordinary usage. Missing fields remain `undefined`; zero is preserved only when the provider explicitly reports it. Existing total/prompt/completion accounting is unchanged.

## Failure and Privacy Behavior

- No session: omit `promptCache`; the request behaves exactly as before.
- Unsupported provider or API mode: ignore `promptCache`; do not reject or retry the request.
- Provider omits cache usage: no cache metric is shown or inferred.
- Provider rejects the candidate cache field: one pre-output fallback removes only `prompt_cache_key`, and only for an exact field-rejection signature.
- Cache keys never include source text, file paths, project names, model IDs, account IDs, or credentials.

## Verification

Tests prove that:

- the agent loop derives an opaque session key and applies it to requests;
- the same session key remains unchanged when the active provider changes;
- the feature is off by default and the independent remote kill switch overrides local opt-in;
- requests without an active session omit cache metadata;
- internal summary requests omit cache affinity;
- the candidate Responses transport forwards the key and standard Chat Completions do not;
- exact cache-field rejection retries once without the field, while generic failures do not replay;
- dialect-specific cache token fields are normalized only when valid and explicitly reported.

Full project validation runs `bun test`, `bun lint`, `bun build`, and `bun run proof`.

These automated checks do not establish a provider cache hit. Promotion requires a current two-turn live request with identical stable prefixes, accepted cache controls, and provider-reported cache usage.
