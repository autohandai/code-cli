# Cross-Provider Prompt Caching — Implementation Plan

**Date:** 2026-07-23

**Status:** Ready for implementation after approval
**Companion design:** [Cross-Provider Prompt Caching — Design](./2026-07-23-cross-provider-prompt-caching-design.md)

## Goal

Add reliable provider-side prompt caching across every Autohand provider path
without changing completion semantics, weakening privacy, fabricating cache
metrics, or breaking custom providers and extensions.

The finished system will:

- preserve provider serialization for an identical prepared request whenever the
  feature is off, relative to the separate OpenRouter response-cache safety
  baseline;
- classify every provider/model/API-mode combination honestly;
- send only documented and allowlisted cache controls;
- normalize cache reads, cache writes, uncached input, logical input, and cost;
- retain one usage event for every dispatched logical request owned by a
  persisted session, while keeping sessionless helper usage in memory;
- keep canonical cache/session identity across CLI, RPC, ACP, browser, and mobile;
- degrade once and continue when an optional cache control is rejected;
- expose consistent usage through Plain, Ink, slash commands, protocols, and
  telemetry-compatible DTOs;
- require current two-turn live evidence before any path is called supported.

## Delivery Contract

This plan is intentionally split into small, reviewable commits. Execute tasks in
order unless a task explicitly says it may run in parallel.

For every implementation task:

1. Inspect the listed production files and existing tests.
2. Add the listed failing tests before editing production code.
3. Run the focused test and capture the expected failure.
4. Implement only the task's contract.
5. Run the focused tests, adjacent regression tests, lint, and typecheck.
6. Review `git diff --check` and stage only the files listed by that task.
7. Commit with the objective message listed by the task and append:

   ```text
   Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
   ```

Do not use abbreviated conventional prefixes in commit messages. Do not add a
dependency without a separately approved design change. Do not alter unrelated
dirty worktree files.

## Non-Negotiable Invariants

- Feature-off provider serialization is byte-equivalent for an identical prepared
  request, relative to the separately baselined OpenRouter response-cache safety
  fix.
- `promptTokens` remains logical input. A valid provider-reported `totalTokens`
  remains authoritative; derive it from prompt plus completion only when absent
  and track any component discrepancy separately.
- Missing cache data remains missing. It never becomes zero.
- Cache writes are never counted as cache hits.
- A provider-wide boolean is never used as the capability decision.
- Raw session IDs, paths, prompts, credentials, and account IDs are never encoded
  into cache identity or additionally exposed by cache metadata. The derived key
  is sent only in the allowlisted provider field and is linkable within its scope.
- Extended retention is explicit opt-in.
- A cache-key hint is never treated as an idempotency key.
- One pre-output fallback is reserved for a verified cache-field rejection;
  cancellation, partial output, generic errors, and unrecognized failures are not
  replayed.
- Mock tests cannot promote a provider to supported.

## Dependency Map

```text
contracts/config
    ├── usage normalization ── catalog pricing
    ├── session accumulator ── usage ledger
    └── capability registry ── cache coordinator
                                  ├── request purposes
                                  ├── prefix stability
                                  └── bounded fallback/retry
                                           ↓
                                  provider adapters
                                           ↓
                              UI + protocol consumers
                                           ↓
                              docs + live evidence + rollout
```

Provider adapter tasks may run in parallel only after Tasks 1–10 are merged.
Each adapter must stay isolated to its own transport and tests.

## Phase 0 — Baseline and Safety Rails

### Task 0: Record the baseline and freeze scope

This task changes no production behavior and creates no commit unless missing
characterization coverage must be added.

**Inspect**

- `src/types.ts`
- `src/config.ts`
- `src/features/featureRegistry.ts`
- `src/core/agent/ReactLoopRunner.ts`
- `src/core/agent/InstructionRunner.ts`
- `src/core/agent/AgentSessionAccounting.ts`
- `src/session/SessionManager.ts`
- `src/providers/usage.ts`
- every provider/client listed in the design matrix
- every `.complete()` call under `src/`

**Preflight**

```bash
git status --short
git rev-parse HEAD
rg -n '\.complete\(' src --glob '*.ts' --glob '*.tsx'
bun test tests/providers/usage.test.ts tests/session/SessionManager.test.ts
bun lint
```

**Record locally in the implementation handoff**

- baseline commit and dirty files;
- existing test failures, if any;
- exact provider/model/API modes configured for later live proof, without
  credentials;
- any source drift from the design's external-contract snapshot.

**Separate OpenRouter response-cache safety baseline**

OpenRouter response caching can replay an old assistant response and tool call, so
it must be disabled independently of provider prompt caching. Before capturing
feature-off goldens:

1. Add a failing `OpenRouterClient` test for `X-OpenRouter-Cache: false`.
2. Add that header without any prompt-cache field.
3. Run the OpenRouter suite and record the new serializer baseline.
4. Commit only this safety change as
   `Disable OpenRouter response caching for agent turns`.

All later byte-equivalence claims are relative to this explicit baseline and are
measured at the provider serializer boundary for an identical prepared request.

**STOP**

Do not begin implementation if the current provider topology no longer matches
the design matrix, or if an unrelated dirty edit overlaps the first task's files
and cannot be safely preserved.

### Task 1: Add configuration, request, usage, and feature-gate contracts

**Files**

- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/features/featureRegistry.ts`
- Modify: `src/features/RemoteFeatureFlagManager.ts`
- Modify: `tests/config.test.ts`
- Modify: `tests/config/configParser.test.ts`
- Modify: `tests/features/featureRegistry.test.ts`
- Modify: `tests/features/RemoteFeatureFlagManager.test.ts`
- Create: `tests/types/promptCachingContracts.test.ts`

**Failing tests first**

- `AgentSettings.promptCaching` accepts only `off | auto`,
  `provider-default | extended`, and the two display booleans.
- JSON, YAML, and TOML config files round-trip the same values.
- A workspace override deep-merges `agent.promptCaching` instead of erasing
  unspecified global fields.
- A workspace override can tighten retention, but cannot elevate from
  provider-default to extended without explicit project approval; any requested
  extended TTL is displayed and capped at 86,400 seconds.
- Invalid enum values fail through the existing config-validation path.
- `features.promptCaching` exists as an experimental, restart-free gate and is
  disabled by default.
- A separately named, non-user-overridable remote
  `prompt_caching_controls_kill_switch` disables request mutation; the local and
  remote controls never share an ID.
- Fake-timer coverage proves startup plus at-most-60-second background refresh,
  no per-request flag fetch, and local off on the next request.
- All additions to `LLMRequest`, `LLMUsage`, and public status types are optional
  so an existing extension provider still typechecks.
- Legacy `SessionUsageMetadata.tokenUsageStatus` remains
  `actual | unavailable`; cache completeness/reporting uses new optional fields.

Run the new tests and require a failure caused by missing contracts, not a broken
fixture.

**Implementation**

- Add `PromptCachingSettings`, `LLMRequestPurpose`, `PromptCacheRequest`,
  `CacheMetricsStatus`, and additive usage/cost fields from the design.
- Add optional `features.promptCaching` to the local feature settings.
- Register `prompt_caching` in the feature registry with experimental metadata,
  default off, and a stable config path.
- Resolve the separate remote kill switch in prompt-cache policy rather than
  registering it under the same local feature ID.
- Add a focused nested merge for `agent.promptCaching`; preserve all other merge
  behavior.
- Store explicit project elevation approval separately from ordinary shallow
  precedence; never interpret a copied config value as consent.
- Do not yet mutate provider requests or parse additional usage.

**Focused validation**

```bash
bun test tests/types/promptCachingContracts.test.ts tests/config.test.ts tests/config/configParser.test.ts tests/features/featureRegistry.test.ts tests/features/RemoteFeatureFlagManager.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Define prompt caching configuration and runtime contracts`

**Exit criteria**

- Gate off is the default in every config format.
- Existing configs and extensions require no migration.
- No provider payload differs.

### Task 2: Make usage normalization provider-dialect aware

**Files**

- Modify: `src/providers/usage.ts`
- Modify: `tests/providers/usage.test.ts`
- Create only if the existing module becomes unfocused:
  `src/providers/usageDialects.ts`

**Failing tests first**

Add table-driven fixtures for:

- OpenAI Chat, Azure, and OpenRouter nested prompt details;
- OpenAI Responses and xAI Responses nested input details;
- Anthropic/Vertex input, cache read, cache creation, and 5-minute/1-hour write
  buckets;
- Bedrock Converse uncached input plus cache reads/writes and cache details;
- DeepSeek hit/miss counters;
- Google native cached-content counters for future compatibility;
- Sakana orchestration cache fields as partial reporting;
- llama.cpp and MLX compatible cached-token details;
- a reported zero versus an absent field;
- negative, non-finite, over-total, and wrong-type cache counters;
- a partial breakdown where writes are absent;
- the legacy generic shape used by custom/extension providers.
- a valid provider-reported total that differs from prompt plus completion.

Assert that a complete breakdown satisfies the three-way prompt invariant, while
a partial breakdown keeps unknown buckets absent. Invalid cache details must not
discard valid ordinary totals.

**Implementation**

- Add an explicit dialect/options argument to `normalizeLLMUsage` while retaining
  the current generic default.
- Keep token parsing finite, non-negative, and integer-safe.
- Normalize logical prompt totals according to the selected dialect.
- Return `reported`, `partial`, `not-reported`, or `not-supported` accurately.
- Preserve a valid provider-reported legacy total; derive one only when absent and
  mark component discrepancies explicitly.
- Discard impossible breakdowns instead of clamping them into apparently valid
  cache evidence.
- Do not change provider call sites yet; this task establishes the pure contract.

**Focused validation**

```bash
bun test tests/providers/usage.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Normalize prompt cache usage by provider dialect`

**Exit criteria**

- Ordinary token behavior remains backward-compatible.
- Unknown and zero are distinguishable.
- Every raw dialect in the design has a deterministic unit fixture.

### Task 3: Preserve cache pricing in the model catalog

**Files**

- Modify: `src/providers/modelCatalog.ts`
- Modify: `src/providers/modelCatalogUpdater.ts` only if validation needs to be
  tightened
- Modify: `src/share/costEstimator.ts`
- Modify: `tests/providers/modelCatalog.test.ts`
- Modify: `tests/providers/modelCatalogUpdater.test.ts`
- Modify: `tests/share/costEstimator.test.ts`

**Failing tests first**

- Pi-compatible `input`, `output`, `cacheRead`, and `cacheWrite` rates survive
  catalog normalization.
- Missing prices stay absent; an explicit zero survives.
- Cache read equal to ordinary input does not claim savings.
- TTL-specific write prices can be represented without flattening them into a
  false single rate.
- Reported provider cost takes precedence over a calculated catalog cost.
- Partial/timeout accounting produces `minimum` or `unavailable`, never a false
  exact total.
- Currency is USD, and calculated/mixed values retain catalog revision, source,
  per-component confidence, and rate provenance.

**Implementation**

- Extend the runtime catalog entry with optional validated pricing fields.
- Preserve existing catalog compatibility and reject non-finite/negative prices.
- Move cost calculation to one pure function shared by usage and share/export.
- Carry currency, catalog revision, source, per-component confidence, and rate
  provenance through the cost type; never collapse mixed evidence into a bare
  exact number.
- Retain the existing simple cost output when no cache detail exists.
- Do not hard-code live provider prices.

**Focused validation**

```bash
bun test tests/providers/modelCatalog.test.ts tests/providers/modelCatalogUpdater.test.ts tests/share/costEstimator.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Preserve cache-aware model pricing and cost confidence`

**Exit criteria**

- Catalog refreshes do not erase cache prices.
- Unknown price is never rendered as free.

## Phase 1 — Canonical Lifecycle and Accounting

### Task 4: Introduce one request/session usage accumulator

**Files**

- Create: `src/core/agent/AgentUsageAccumulator.ts`
- Modify: `src/core/agent/AgentSessionAccounting.ts`
- Modify: `src/core/agent.ts`
- Modify: `src/core/agent/AgentDependencyComposer.ts`
- Modify: `src/core/agent/AgentContextRuntime.ts`
- Modify: `src/core/agent/AgentUIRuntime.ts`
- Modify: `src/core/agent/ReactLoopRunner.ts`
- Modify: `src/core/agent/SimpleChatHandler.ts`
- Modify: `src/core/agent/InstructionRunner.ts`
- Modify: `src/core/agent/AgentFormatter.ts`
- Create: `tests/core/agent/AgentUsageAccumulator.test.ts`
- Modify: `tests/core/agent/ReactLoopRunnerStatus.test.ts`
- Modify: `tests/core/tokenUsageStatus.format.test.ts`

**Failing tests first**

- A multi-request tool loop accumulates each provider request exactly once.
- The completed turn is not counted again when persisted.
- SimpleChat and the ReAct loop produce identical usage snapshots.
- `reset()` clears every ordinary/cache/cost/reporting field.
- `hydrate()` restores a legacy or cache-aware session aggregate.
- `lastPromptTokens` is separate from cumulative session input.
- Partial cache coverage remains partial after aggregation.
- A failed-before-send request records no usage; a partial terminal response may
  record its reported minimum.
- `beginTurn`, idempotent `recordRequest`, `finishTurn`, and `abortTurn` have
  explicit transitions. Finish never adds tokens again; abort retains usage that
  was already reported as spent.

**Implementation**

- Make the new accumulator the single owner of live request, turn, and session
  usage state.
- Expose immutable `getTurnSnapshot()` and `getSessionSnapshot()` values.
- Give every request event an idempotency key so `recordRequest` cannot apply it
  twice.
- Preserve legacy host getters temporarily as adapters to the snapshot.
- Preserve legacy `actual | unavailable` status for old consumers and expose
  detailed completeness separately.
- Route ReAct, SimpleChat, formatter, and turn persistence through the same
  accumulator.
- Remove double-count paths only after their characterization tests fail for the
  expected reason.

**Focused validation**

```bash
bun test tests/core/agent/AgentUsageAccumulator.test.ts tests/core/agent/ReactLoopRunnerStatus.test.ts tests/core/tokenUsageStatus.format.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Centralize request turn and session usage accounting`

**Exit criteria**

- One request creates one accumulation event.
- Existing status totals do not change for non-cache fixtures.

### Task 5: Correct local session transitions and branch accounting

**Files**

- Modify: `src/session/types.ts`
- Modify: `src/session/SessionManager.ts`
- Modify: `src/core/agent/AgentLifecycleRunner.ts`
- Modify: `src/core/agent/AgentCommandRuntime.ts`
- Modify: `src/commands/new.ts`
- Modify: `src/commands/clear.ts`
- Modify: `src/commands/resume.ts`
- Modify: `src/commands/sessionBranching.ts`
- Modify: `src/index.ts`
- Modify: `tests/session/SessionManager.test.ts`
- Modify: `tests/session/sessionBranching.test.ts`
- Modify: `tests/commands/new.test.ts`
- Modify: `tests/commands/clear.test.ts`
- Modify: `tests/commands/resume.spec.ts`
- Modify: `tests/commands/sessionBranching.test.ts`
- Modify: `tests/commands/sessionBranchingStories.test.ts`
- Add focused lifecycle tests under `tests/core/agent/` if existing coverage cannot
  exercise resume/hydration directly

**Failing tests first**

- New and clear create a new persisted session and reset live usage.
- Resume and attach hydrate the matching persisted aggregate.
- Resume failure creates a new identity and resets usage.
- Direct `--resume` and `--fork` take the same reset/hydrate paths as slash
  commands.
- Fork and clone receive new session IDs, empty usage, empty usage ledgers, and
  explicit lineage; conversation/state copying remains unchanged.
- Imported legacy sessions load with cache reporting unknown.
- No required field is added to `index.json`.
- Atomic metadata updates preserve every optional aggregate field.
- Provider/model switches rotate the active cache domain through
  `AgentCommandRuntime` without resetting already-spent session usage.

**Implementation**

- Add optional versioned aggregate fields to session metadata.
- Centralize local lifecycle activation so create/new/clear/resume/fork/clone all
  call the same accumulator reset/hydrate contract.
- Stop spreading parent `metadata.usage` into a child branch.
- Preserve branch lineage without copying spent-token activity.
- Keep legacy session casts fail-soft and migration-free.

**Focused validation**

```bash
bun test tests/session/SessionManager.test.ts tests/session/sessionBranching.test.ts tests/commands/new.test.ts tests/commands/clear.test.ts tests/commands/resume.spec.ts tests/commands/sessionBranching.test.ts tests/commands/sessionBranchingStories.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Make session transitions reset and hydrate usage consistently`

**Exit criteria**

- Session totals cannot leak between identities.
- Branch lineage and activity accounting are distinct.

### Task 6: Align RPC, ACP, browser, and mobile session identity

**Files**

- Modify: `src/modes/rpc/adapter.ts`
- Modify: `src/modes/rpc/protocol.ts`
- Modify: `src/modes/rpc/types.ts`
- Modify: `src/modes/acp/adapter.ts`
- Modify: `src/modes/acp/types.ts`
- Modify: `src/browser/chrome.ts`
- Modify: `src/index.ts`
- Modify: `src/core/AutomodeManager.ts`
- Modify: `src/core/conversationManager.ts`
- Modify: mobile turn/session wiring only where it creates or exposes identity
- Modify: `tests/modes/rpc/protocol.spec.ts`
- Modify: `tests/modes/rpc/adapter.shutdown.spec.ts` or add a focused RPC session
  lifecycle suite
- Modify: `tests/modes/acp/adapter.test.ts`
- Modify: `tests/mobile/AgentMobileTurnLifecycle.test.ts`
- Modify: `tests/automode.spec.ts`
- Modify: `tests/automode.integration.spec.ts`
- Create: `tests/modes/acp/concurrentSessions.test.ts`
- Modify: browser handoff tests adjacent to `src/browser/chrome.ts`

**Failing tests first**

- Each external RPC/ACP ID maps to exactly one persisted session ID.
- RPC reset closes/creates a real persisted session and rotates the canonical ID.
- ACP new/resume/fork returns an external ID mapped to the correct persisted
  session; ACP fork preserves the requested history.
- Browser handoff attach reuses its persisted session.
- `--browser` startup does not create two persisted sessions.
- Mobile observes the same canonical session used by the instruction runner.
- Auto-mode startup does not create a session separate from the agent runtime.
- Two concurrent ACP sessions have agent-scoped conversation state and cannot
  exchange messages, usage, or cache identity.
- ACP resume leaves no orphan session created during RPC-style initialization.
- External IDs never appear in the future provider cache-key input fixture.

**Implementation**

- Introduce one explicit external-to-persisted session mapping contract.
- Route adapter resets and forks through the lifecycle API from Task 5.
- Preserve all public protocol IDs and response shapes.
- Add optional canonical metadata internally; do not make it a required public
  field.
- Remove the browser eager-session duplication without changing handoff behavior.
- Replace the global conversation singleton on multi-agent ACP paths with
  agent-scoped state before enabling cache identity.

**Focused validation**

```bash
bun test tests/modes/rpc tests/modes/acp tests/mobile/AgentMobileTurnLifecycle.test.ts tests/automode.spec.ts tests/automode.integration.spec.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Unify persisted session identity across client transports`

**Exit criteria**

- Every runtime surface resolves one canonical persisted session.
- Existing RPC and ACP clients remain wire-compatible.

### Task 7: Persist canonical context mutations for reliable replay

**Files**

- Modify: `src/session/types.ts`
- Modify: `src/session/SessionManager.ts`
- Modify: `src/core/context/orchestrator.ts`
- Modify: `src/core/context/compactor.ts`
- Modify: `src/core/conversationManager.ts`
- Modify: `src/core/agent/AgentLifecycleRunner.ts`
- Modify: `src/core/agent/ReactLoopRunner.ts`
- Modify: `src/core/agent/AgentToolOutputRuntime.ts`
- Modify: `src/commands/undo.ts`
- Modify: `tests/contextCompaction.spec.ts`
- Modify: `tests/contextSummarization.spec.ts`
- Add: focused replay tests under `tests/session/` only if existing suites cannot
  cover resume reconstruction

**Failing tests first**

- With unchanged system/bootstrap inputs, resume reconstructs the exact message
  context used after 70/80/90-percent compaction paths.
- Overflow recovery and smart crop replay the same summary/removals.
- Undo remains undone after resume.
- Transient streamed tool chunks do not become duplicate ordinary messages on
  reload.
- A legacy transcript with no mutation events still loads as before.
- Changed config, skills, memories, locale, or instructions produce deterministic
  transcript replay plus a cache-epoch rotation rather than a false byte-identical
  full-context claim.
- Corrupt trailing mutation data fails soft without discarding the transcript.

**Implementation**

- Add a versioned replayable context-mutation event or canonical context snapshot
  owned by the session layer; choose one representation and document it in the
  session type.
- Persist mutations at the point they become authoritative, not later during UI
  rendering.
- Rebuild the live context from transcript plus mutation state on resume.
- Keep system prompt content out of new persisted cache metadata.
- Treat a replay mismatch as a cache epoch discontinuity in the later
  coordinator, never as a cache hit expectation.

**Focused validation**

```bash
bun test tests/session tests/contextCompaction.spec.ts tests/contextSummarization.spec.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Persist context mutations for deterministic session replay`

**Exit criteria**

- Persisted and in-memory message context are equivalent after resume.
- No new raw system prompt or cache identity is persisted.

### Task 8: Add the per-request usage ledger

**Files**

- Create: `src/session/UsageLedger.ts`
- Create: `src/core/agent/LLMRequestExecutor.ts`
- Modify: `src/session/types.ts`
- Modify: `src/session/SessionManager.ts`
- Modify: `src/core/agent/AgentSessionAccounting.ts`
- Modify: `src/core/agent/AgentDependencyComposer.ts`
- Modify: `src/providers/LLMProvider.ts`
- Modify: `src/extensions/ExtensionRuntimeHost.ts`
- Create: `tests/core/agent/LLMRequestExecutor.test.ts`
- Modify: `src/sync/SyncService.ts`
- Modify: `src/sync/types.ts`
- Create: `tests/session/UsageLedger.test.ts`
- Modify: `tests/session/SessionManager.test.ts`
- Modify: `tests/core/agentSessionSync.spec.ts`
- Modify: `tests/sync/integration.test.ts`
- Modify: `tests/sync/pathSafety.test.ts`

**Failing tests first**

- One completed LLM request appends one schema-v1 JSONL event.
- Tool-loop requests and auxiliary requests retain distinct event IDs/purposes.
- Primary and auxiliary calls all cross one executor wrapper installed during
  dependency composition.
- Concurrent append requests serialize without interleaving lines.
- Concurrent processes do not interleave or lose accepted lines.
- Replaying the same idempotent event ID does not duplicate usage.
- Logical request IDs remain stable while transport-attempt IDs remain distinct.
- A partial stream and failed-after-send request can record minimum known usage.
- Failed-before-send requests do not create billable usage events.
- Sessionless helper calls return in-memory usage, receive no cache hints, and do
  not invent a session ledger.
- Metadata aggregate and ledger agree after normal completion.
- Every event has a monotonic session `sequence`, and metadata records
  `lastAppliedSequence` for crash-safe reconciliation.
- A truncated final line is ignored/reported safely; earlier events survive.
- A crash after ledger append but before aggregate update reconciles exactly once
  at the next load.
- The active ledger rotates at 8 MiB, retains at most three rolled segments, and
  preserves the all-time metadata aggregate.
- Fork/clone start with an empty ledger.
- Keys, salts, prefix signatures, prompts, paths, and raw provider errors are
  absent from serialized fixtures.
- Active/rolled ledgers, locks, and aggregate checkpoint files are excluded from
  session sync before the first ledger is created.

**Implementation**

- Implement the versioned `usage.jsonl` schema from the design.
- Implement one `LLMRequestExecutor` wrapper that owns logical/attempt IDs,
  dispatch state, partial/usable output state, applied controls, shared attempt
  budget, normalization, and ledgering for primary and auxiliary calls.
- Keep cache controls and bounded internal-retry claims disabled for an extension
  unless it advertises compatible capability and attempt-budget awareness.
- Queue appends per session and flush them before session close.
- Lock append, rotation, sequence assignment, and aggregate checkpoint as one
  inter-process-safe operation with idempotent event IDs.
- Keep `metadata.usage` as the atomic list/dashboard aggregate.
- Load legacy sessions without creating or rewriting a ledger until the next
  request.
- Add a bounded read API for diagnostics; do not load an unbounded ledger into
  startup memory.
- Bound serialized line size, redact before append, rotate at 8 MiB, and retain
  no more than 32 MiB of request-level detail.
- Install sync exclusions for all ledger files before the first write.
- Define an event as one dispatched logical request. Failed-before-send calls are
  not events; transport retries remain attempt IDs inside the logical event.
- Close in the order ledger flush, aggregate checkpoint, optional sync, then
  session close.

**Focused validation**

```bash
bun test tests/core/agent/LLMRequestExecutor.test.ts tests/session/UsageLedger.test.ts tests/session/SessionManager.test.ts tests/core/agentSessionSync.spec.ts tests/sync/integration.test.ts tests/sync/pathSafety.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Instrument provider requests and record session-owned usage`

**Exit criteria**

- Request-level accounting survives resume.
- Session close cannot silently lose accepted ledger writes.

## Phase 2 — Cache Policy, Identity, and Request Shaping

### Task 9: Build the capability registry and conservative policy resolver

**Files**

- Create: `src/providers/promptCaching.ts`
- Modify: `src/providers/LLMProvider.ts`
- Modify: `src/providers/ProviderFactory.ts`
- Modify: `src/providers/errors.ts`
- Modify: `src/providers/modelCapabilities.ts` only for reusable model-family
  classification
- Create: `tests/providers/promptCaching.test.ts`
- Modify: `tests/providers/apiErrors.test.ts`
- Modify: `tests/providers/nativeToolCapabilities.test.ts`
- Modify: `tests/providers/ProviderFactory.spec.ts`

**Failing tests first**

- Resolution keys include provider, normalized endpoint class, API mode, model
  allowlist entry, and streaming/non-streaming transport.
- Every built-in provider path resolves to controlled, implicit, observe-only, or
  none; no path falls through accidentally.
- OpenAI API-key Chat and ChatGPT OAuth Responses resolve differently.
- Vertex Claude/Gemini and Bedrock Converse/OpenAI Chat/OpenAI Responses resolve
  differently.
- OpenRouter resolution includes routed model family.
- Hosted NVIDIA differs from an explicitly configured self-hosted NIM endpoint.
- Custom and extension providers default to none/observe-only.
- Unknown model versions never inherit controls by string comparison.
- An expired `expiresAt` verification resolves request controls to observe-only at
  runtime.
- A remote catalog can select only validated capability IDs and cannot inject a
  header, field, URL, key, or arbitrary serializer.
- Gate off and `mode: off` produce no request mutation while usage parsing remains
  enabled.
- The distinct non-user-overridable remote kill switch wins over an enabled local
  gate and cannot be shadowed by the registry's same-ID precedence.

**Implementation**

- Define a pure, dated capability registry with explicit cells.
- Separate request-control capability from usage-observation capability.
- Track automatic behavior, affinity, breakpoints, retention, usage dialect,
  read/write reporting, minimum prefix, and streaming/non-streaming evidence as
  orthogonal capabilities per cell.
- Resolve user policy and extended-retention downgrade without throwing.
- Add structured exact-cache-field rejection classification to provider errors;
  generic HTTP 400 remains ordinary invalid request.
- Keep all new provider-interface properties optional.

**Focused validation**

```bash
bun test tests/providers/promptCaching.test.ts tests/providers/apiErrors.test.ts tests/providers/nativeToolCapabilities.test.ts tests/providers/ProviderFactory.spec.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Resolve prompt cache capability by provider transport and model`

**Exit criteria**

- The matrix is executable, exhaustive, and conservative.
- No provider request has changed yet.

### Task 10: Implement secure cache identity and epoch coordination

**Files**

- Create: `src/core/agent/PromptCacheCoordinator.ts`
- Create: `src/core/agent/PromptCacheSecretStore.ts` if keeping secret I/O in the
  coordinator would violate the focused-module boundary
- Modify: `src/utils/atomicFile.ts`
- Modify: `src/core/agent/AgentContextRuntime.ts`
- Modify: `src/core/agent/AgentLifecycleRunner.ts`
- Modify: `src/core/agent/ProviderConfigManager.ts`
- Modify: `src/core/agent.ts`
- Modify: `src/sync/SyncService.ts`
- Modify: `src/sync/types.ts`
- Create: `tests/core/agent/PromptCacheCoordinator.test.ts`
- Create: `tests/core/agent/PromptCacheSecretStore.test.ts` when the store is split
- Modify: `tests/core/agent/ProviderConfigManager.openai.test.ts`
- Create: `tests/security/promptCacheRedaction.test.ts`

**Failing tests first**

- The secret is created atomically at
  `$AUTOHAND_HOME/prompt-cache/secret-v1` with 32 random bytes and POSIX mode
  `0600`.
- Parallel processes racing to create the secret converge on one valid value.
- Symlinks, non-regular files, permissive modes, unexpected ownership where
  available, truncation, corruption, and EACCES disable hints without failing the
  model call.
- Windows behavior avoids claiming POSIX-mode enforcement while retaining atomic
  creation and fail-open validation.
- Same session/capability/purpose/epoch derives the same bounded base64url HMAC.
- New, clear, fork, clone, import, provider, endpoint, API mode, model domain,
  credential-scope generation, purpose, and epoch derive distinct keys.
- No persisted session means no cache key.
- Raw credentials/account IDs are never hashed as tuple inputs; rotating the
  local opaque credential-scope generation rotates the key.
- Resume/attach reuses continuity only when an opaque local prefix signature and
  epoch match; otherwise it rotates.
- Secret rotation invalidates prior continuity.
- Saving/replacing an effective configured credential increments only the opaque
  credential-scope generation; environment-only credentials use a conservative
  process generation and never require hashing their value.
- Debug values and thrown errors contain none of the canary session/path/prompt/
  credential/key material.
- Sync enumeration cannot include the prompt-cache directory under any consent
  setting.

**Implementation**

- Store the installation secret and bounded continuity registry only below the
  resolved `AUTOHAND_HOME/prompt-cache/` directory; exclude it from session sync.
- Install the `prompt-cache/` sync exclusion before the store can write it.
- Use Node's built-in cryptography for HMAC-SHA-256 and timing-safe comparisons;
  add no dependency.
- Keep local credential-scope generation opaque and independent of credential
  contents.
- Route in-process provider credential changes through `ProviderConfigManager`;
  for external config-file changes use non-secret file revision metadata, and for
  environment-only credentials prefer safe cache-key rotation over continuity.
- Make the coordinator lifecycle-owned and provider-stateless.
- Track epochs for every discontinuity in the design and expire local downgrade
  state after 30 minutes or an epoch/capability change.
- Bound continuity entries, prune stale entries, and use HMAC signatures only;
  never persist raw prefix data or a plain prompt digest.
- Expose immutable per-request cache context.

**Focused validation**

```bash
bun test tests/core/agent/PromptCacheCoordinator.test.ts tests/core/agent/PromptCacheSecretStore.test.ts tests/core/agent/ProviderConfigManager.openai.test.ts
bun run typecheck
bun lint
git diff --check
```

If the store remains in the coordinator, omit the nonexistent test path from the
command.

**Commit**

- Message: `Derive isolated prompt cache identity from protected local state`

**Exit criteria**

- Identity failures turn caching off, not the agent.
- No raw identity input is observable outside the coordinator.

### Task 11: Declare every LLM request purpose and stabilize eligible prefixes

**Files**

- Modify: `src/core/agent/ReactLoopRunner.ts`
- Modify: `src/core/agent/SimpleChatHandler.ts`
- Modify: `src/core/agent/AgentCommandRuntime.ts`
- Modify: `src/core/agent/InteractionModeController.ts`
- Modify: `src/core/agents/SubAgent.ts`
- Modify: `src/core/context/summarizer.ts`
- Modify: `src/core/contextManager.ts`
- Modify: `src/core/SuggestionEngine.ts`
- Modify: `src/memory/extractSessionMemories.ts`
- Modify: `src/commands/agents-new.ts`
- Modify: `src/commands/repeat.ts`
- Modify: `src/commands/skills-new.ts`
- Modify: `src/skills/LearnAdvisor.ts`
- Modify: `src/skills/autoSkill.ts`
- Modify: `src/core/toolFilter.ts`
- Modify: `src/core/toolManager.ts`
- Modify: `src/core/conversationManager.ts`
- Modify: `src/mcp/McpClientManager.ts`
- Modify: `src/extensions/ExtensionRuntimeHost.ts`
- Create: `tests/core/llmRequestPurposeCoverage.test.ts`
- Modify adjacent behavior tests for every call site above
- Modify: `tests/core/agents/SubAgent.test.ts`
- Modify: `tests/contextSummarization.spec.ts`
- Modify: `tests/core/SuggestionEngine.test.ts`

**Failing tests first**

- A static coverage test enumerates every internal direct `llm.complete()` call
  and requires an explicit purpose.
- Main ReAct and SimpleChat calls resolve to `agent`.
- Subagents use `subagent` and a child-specific random scope.
- Compaction, final summaries, suggestions, memory, skills, and utilities receive
  their explicit purposes but no cache controls initially.
- An external/extension request with omitted purpose resolves to `utility` and no
  controls.
- Eligible tool definitions remain in the existing wire order and availability;
  caching never freezes or changes the tool set.
- `tool_search` and other dynamic expansion retain current behavior, bump
  `prefixRevision`, and prevent explicit-control reuse across the changed wire
  snapshot.
- Internal recursive canonicalization yields a stable signature while leaving the
  serialized provider payload byte-identical.
- Feature off leaves tool selection and serialization unchanged.

**Implementation**

- Add purpose to every internal call site.
- Inject coordinator context only at the agent-owned request boundary.
- Preserve tool selection and dynamic availability for every path. Disable
  explicit controls where wire equivalence cannot be proven.
- Build signatures from a canonical copy. Never mutate semantic arrays or wire
  objects while signing.
- Increment the epoch for system/bootstrap, memory, skills, team, locale,
  permission, mode, tool registration, compaction, crop, undo, and replay changes.
- Own non-append invalidation through one monotonic `prefixRevision` in
  conversation/context state. Mutation owners bump it; the coordinator also
  compares automatic system and tool signatures so a missed explicit event fails
  toward rotation, not unsafe reuse.

**Focused validation**

```bash
bun test tests/core/llmRequestPurposeCoverage.test.ts tests/core/agents/SubAgent.test.ts tests/contextSummarization.spec.ts tests/core/SuggestionEngine.test.ts tests/core/agent/ReactLoopRunnerStatus.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Scope prompt cache policy across every LLM request purpose`

**Exit criteria**

- No internal call silently inherits the main session cache namespace.
- Feature-off provider wire fixtures remain unchanged.

### Task 12: Bound retries and implement one safe cache-control fallback

**Files**

- Modify: `src/core/agent/LLMRequestExecutor.ts`
- Modify: `src/providers/LLMProvider.ts`
- Modify: `src/providers/errors.ts`
- Modify: `src/core/errorLogger.ts`
- Modify: `src/core/agent/InstructionRunner.ts`
- Modify provider transport retry helpers as required to honor one budget
- Modify: `tests/core/agent/LLMRequestExecutor.test.ts`
- Modify: `tests/providers/apiErrors.test.ts`
- Modify: `tests/security/promptCacheRedaction.test.ts`
- Modify: `tests/core/agent/InstructionRunner.command-mode.test.ts`

**Failing tests first**

- A verified provider code plus exact rejected cache parameter retries once with
  only cache controls removed.
- A generic 400, unrelated invalid parameter, authentication failure, rate limit,
  timeout, or server error does not trigger cache fallback.
- Cancellation propagates immediately.
- Any partial output or emitted tool call prevents fallback replay.
- Transport retries reuse byte-identical cache context and serialized controls.
- Applying controls reserves one cache-free fallback slot inside the logical
  request attempt budget; outer and inner loops cannot consume or multiply it.
- One logical request keeps one ledger identity and distinct transport-attempt
  IDs without double-counting usage.
- Downgrade expires after its TTL and clears on epoch/capability changes.
- When non-fallback budget is exhausted, the original meaningful provider error
  survives; the reserved slot is usable only for a verified pre-output
  cache-field rejection.

**Implementation**

- Extend the single executor from Task 8 with one shared fallback path; do not add
  a second provider wrapper.
- Add an optional internal attempt-budget context that existing extension
  providers may ignore safely.
- Strip only fields the adapter marked as cache controls.
- Record structured, redacted downgrade reason and attempt outcome.
- Persist only a closed downgrade reason code; free-form provider errors remain
  transient and redacted.
- Never treat cache keys as idempotency controls.

**Focused validation**

```bash
bun test tests/core/agent/LLMRequestExecutor.test.ts tests/providers/apiErrors.test.ts tests/core/agent/InstructionRunner.command-mode.test.ts tests/security/promptCacheRedaction.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Bound cache fallback within one logical request budget`

**Exit criteria**

- A rejected optimization cannot lose a valid completion.
- Retry amplification is measurably bounded.

### Phase 2 gate

Before any provider emits controls:

```bash
bun test tests/core/agent tests/session tests/providers/usage.test.ts tests/providers/promptCaching.test.ts tests/security/promptCacheRedaction.test.ts
bun run typecheck
bun lint
CI=true bun run proof
```

Require zero cache-control fields in provider payload fixtures at this checkpoint.

## Phase 3 — Provider Adapters

Each provider task implements and fixture-tests its candidate control, but leaves
the production capability cell observe-only until Task 27 records live proof and
adds the dated verified allowlist entry. Automatic providers need live accounting
proof before their metrics are described as observable.

### Task 13: Implement OpenAI API-mode-specific caching

**Files**

- Modify: `src/providers/OpenAIProvider.ts`
- Modify: `src/providers/openaiAuth.ts` only for opaque credential-scope rotation
- Modify: `tests/providers/OpenAIProvider.test.ts`
- Modify: `tests/providers/OpenAIProvider.reasoningEffort.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- API-key Chat candidate mode sends the exact stable `prompt_cache_key` field.
- GPT-5.6+ candidate fixtures send only currently documented explicit breakpoint,
  mode, and TTL fields; older/unlisted models receive none.
- Earlier-model retention controls are isolated from GPT-5.6+ controls.
- ChatGPT OAuth Responses sends no public-API cache controls and retains
  `store: false`.
- Chat and Responses usage details normalize with their own dialects, including
  partial or absent writes.
- Streaming terminal usage is captured; cancellation/partial output is not
  replayed.
- Gate off and unsupported model payloads/headers match baseline goldens.
- Verified cache-parameter rejection is classified; generic invalid requests are
  not.

**Implementation**

- Keep API-key Chat and ChatGPT OAuth Responses as separate capability modes.
- Translate only candidate capability data supplied by the registry.
- Preserve exact static-prefix ordering and existing auth/response behavior.
- Pass explicit OpenAI Chat or Responses dialect to usage normalization.
- Leave production control allowlists empty until live evidence.

**Focused validation**

```bash
bun test tests/providers/OpenAIProvider.test.ts tests/providers/OpenAIProvider.reasoningEffort.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Add mode-specific OpenAI prompt cache translation and accounting`

**Exit criteria**

- OAuth backend remains conservative.
- No older model can receive GPT-5.6+ fields by name inference.

### Task 14: Implement Azure OpenAI observation and allowlisted affinity

**Files**

- Modify: `src/providers/AzureProvider.ts`
- Modify: `src/providers/AzureClient.ts`
- Modify: `tests/providers/AzureClient.test.ts`
- Modify: `tests/providers/AzureProvider.test.ts`
- Modify: `tests/providers/AzureTypes.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- API version, deployment/model, and endpoint class all participate in capability
  resolution.
- Nested cached tokens parse while write tokens remain absent when unreported.
- Candidate verified combinations send only Azure-supported affinity fields.
- OpenAI explicit breakpoint/options fields never leak into Azure payloads.
- Extended retention downgrades when the selected Azure mode cannot verify it.
- Streaming and non-streaming usage evidence are tracked separately.
- Off/unlisted payloads match exact baseline goldens.

**Implementation**

- Set Azure's default production stance to automatic/observe-only.
- Add candidate `prompt_cache_key` translation only for explicit API-version,
  deployment/model-family cells.
- Select the OpenAI Chat usage dialect without fabricating writes.
- Keep production mutation disabled until a live Azure artifact exists.

**Focused validation**

```bash
bun test tests/providers/AzureClient.test.ts tests/providers/AzureProvider.test.ts tests/providers/AzureTypes.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Observe Azure cache usage and gate model-specific affinity`

**Exit criteria**

- Azure capability never inherits OpenAI behavior accidentally.
- Missing writes display as unknown.

### Task 15: Implement OpenRouter affinity, breakpoints, and real SSE usage

**Files**

- Modify: `src/providers/OpenRouterProvider.ts`
- Modify: `src/providers/OpenRouterClient.ts`
- Modify: `src/providers/modelCapabilities.ts`
- Modify: `tests/providers/OpenRouterClient.test.ts`
- Modify: `tests/providers/modelCapabilities.spec.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- The top-level request-body `session_id` receives the opaque value and enforces
  the 256-character limit.
- The separate response cache is explicitly disabled with
  the already-baselined `X-OpenRouter-Cache: false` header fixture.
- Anthropic-compatible routed models place a bounded number of `cache_control`
  markers in tools, system, then history order.
- Non-Anthropic routes receive no block markers.
- Provider-default and extended TTL requests map only where the routed model
  supports them.
- Real SSE chunks, terminal usage, `[DONE]`, malformed chunks, cancellation, and
  partial streams are handled correctly.
- Nested read/write accounting normalizes without counting writes as hits.
- Off/unlisted route payloads and headers match the post-safety baseline goldens.

**Implementation**

- Replace ordinary JSON parsing on streaming requests with the repository's
  established SSE parser pattern.
- Resolve cache shaping by routed model family.
- Keep response caching conceptually and structurally separate from prompt
  caching.
- Bound marker count and preserve existing content/tool semantics.
- Keep production prompt-control cell observe-only until live proof.

**Focused validation**

```bash
bun test tests/providers/OpenRouterClient.test.ts tests/providers/modelCapabilities.spec.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Add routed OpenRouter prompt caching and terminal SSE usage`

**Exit criteria**

- Prompt caching cannot return a stale cached model response.
- Streaming use is production-equivalent to non-streaming accounting.

### Task 16: Implement explicit dialects for the LLM Gateway family

**Files**

- Modify: `src/providers/LLMGatewayClient.ts`
- Modify: `src/providers/LLMGatewayProvider.ts`
- Modify: `src/providers/ZaiProvider.ts`
- Modify: `src/providers/DeepSeekProvider.ts`
- Modify: `src/providers/SakanaProvider.ts`
- Modify: `src/providers/CustomOpenAICompatibleProvider.ts`
- Modify: `src/providers/customProviders.ts`
- Modify: `tests/providers/LLMGatewayClient.spec.ts`
- Modify: `tests/providers/LLMGatewayProvider.spec.ts`
- Modify: `tests/providers/ZaiProvider.test.ts`
- Modify: `tests/providers/DeepSeekProvider.test.ts`
- Create: `tests/providers/SakanaProvider.test.ts`
- Create: `tests/providers/CustomOpenAICompatibleProvider.test.ts`

**Failing tests first**

- Each wrapper passes an explicit provider and usage dialect; base URL shape does
  not guess semantics.
- LLM Gateway terminal SSE usage retains nested read/write details.
- Gateway cache-control/affinity candidates are sent only for a verified gateway
  policy cell; response caching stays off.
- DeepSeek sends no mutation and maps hit plus miss to logical prompt input.
- Z.ai sends no undocumented mutation and parses its documented cached-token
  shape.
- Sakana remains observe-only and preserves orchestration cache detail as partial
  evidence.
- Custom endpoints send no control by default and expose no cache breakdown
  unless a validated dialect is explicitly configured.
- Unknown/custom off payloads remain baseline-equivalent.
- Streaming cancellation, malformed terminal usage, and missing usage fail soft.

**Implementation**

- Add explicit client construction options for provider namespace and dialect.
- Preserve usage from terminal SSE events.
- Implement candidate gateway policy translation separately from response cache.
- Keep DeepSeek, Z.ai, and Sakana automatic/observe-only until live evidence.
- Add a constrained custom-provider capability configuration that selects only a
  known dialect/capability enum.

**Focused validation**

```bash
bun test tests/providers/LLMGatewayClient.spec.ts tests/providers/LLMGatewayProvider.spec.ts tests/providers/ZaiProvider.test.ts tests/providers/DeepSeekProvider.test.ts tests/providers/SakanaProvider.test.ts tests/providers/CustomOpenAICompatibleProvider.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Separate cache semantics across LLM Gateway compatible providers`

**Exit criteria**

- One shared client no longer implies one usage/cache dialect.
- Custom endpoints remain conservative and explicit.

### Task 17: Implement Vertex Claude controls and Gemini observation

**Files**

- Modify: `src/providers/VertexAIProvider.ts`
- Modify: `tests/providers/VertexAIProvider.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- Vertex Claude and Vertex Gemini resolve as distinct API modes.
- Claude candidate fixtures place `cache_control` in the valid tools, system, and
  message order with a bounded marker count.
- Provider-default and verified extended TTL are not mixed incorrectly.
- Anthropic usage reconstructs logical prompt input from uncached/read/write and
  retains 5-minute/1-hour writes.
- Claude streaming terminal events retain cache usage.
- Gemini OpenAI-compatible mode receives no native `CachedContent` resource or
  undocumented control.
- Gemini compatible cache metrics remain absent until a verified fixture proves
  their semantics.
- Off/unlisted payloads match baseline goldens.

**Implementation**

- Add Anthropic block translation only to the Claude `streamRawPredict` path.
- Keep Gemini on its existing OpenAI-compatible transport and observe-only.
- Use separate usage dialects and capability cells.
- Keep Claude production controls disabled until live proof.

**Focused validation**

```bash
bun test tests/providers/VertexAIProvider.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Add Vertex Claude cache controls without assuming Gemini parity`

**Exit criteria**

- No Anthropic field can reach the Gemini transport.
- TTL-specific writes survive normalization.

### Task 18: Implement mode-specific AWS Bedrock caching

**Files**

- Modify: `src/providers/BedrockProvider.ts`
- Modify: `tests/providers/BedrockProvider.test.ts`
- Modify: `tests/providers/BedrockProvider.config.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- Converse candidate fixtures place `cachePoint` only at supported tools/system/
  message boundaries and within the model's marker limits.
- Converse 5-minute/1-hour policy is model/capability gated.
- Bedrock `inputTokens` remains uncached input; logical prompt adds cache reads and
  writes; `cacheDetails` and TTL buckets survive.
- Cross-region duplicate writes do not trigger a deterministic prefix-bug label.
- Bedrock OpenAI Chat and Responses receive no Converse cache points.
- Their compatible usage shapes parse only under the matching dialect.
- Off/unlisted mode payloads match baseline goldens.
- Provider-specific cache-field rejection classifies only exact AWS validation
  paths.

**Implementation**

- Keep three Bedrock API modes separate in capability and serialization.
- Translate candidate cache points only in Converse.
- Normalize Converse usage with AWS semantics.
- Keep all production controls observe-only until live proof for the exact model
  and region/transport cell.

**Focused validation**

```bash
bun test tests/providers/BedrockProvider.test.ts tests/providers/BedrockProvider.config.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Add native Bedrock Converse cache points by model capability`

**Exit criteria**

- Converse semantics never leak into Bedrock's OpenAI-compatible modes.
- Logical input accounting is correct for AWS-exclusive counters.

### Task 19: Implement xAI and Cerebras observation and candidate affinity

**Files**

- Modify: `src/providers/XAIProvider.ts`
- Modify: `src/providers/CerebrasProvider.ts`
- Modify: `src/providers/CerebrasClient.ts`
- Modify: `tests/providers/XAIProvider.test.ts`
- Create: `tests/providers/CerebrasClient.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- xAI Responses parses nested cached input and sends only the documented
  Responses-compatible candidate affinity field.
- Chat-only `x-grok-conv-id` never reaches the current Responses transport.
- Cerebras parses cached prompt tokens from non-streaming and terminal streaming
  responses.
- Cerebras automatic caching works with no Autohand key.
- `prompt_cache_key` is a candidate only for a dated allowlisted model/API cell.
- A Cerebras hit does not claim dollar savings when cached and ordinary input
  prices are equal.
- Unsupported/off payloads match baseline goldens.
- Cancellation/partial stream behavior does not replay output.

**Implementation**

- Select Responses dialect for xAI and Chat dialect for Cerebras.
- Preserve current response/tool behavior.
- Implement candidate key translation behind injected test capability.
- Keep production controls observe-only until separate live artifacts exist.

**Focused validation**

```bash
bun test tests/providers/XAIProvider.test.ts tests/providers/CerebrasClient.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Observe xAI and Cerebras cache usage with gated affinity`

**Exit criteria**

- Neither adapter sends a control borrowed from its other API mode.
- Reported hits and monetary savings remain separate facts.

### Task 20: Preserve NVIDIA hosted and self-hosted distinctions

**Files**

- Modify: `src/providers/NVIDIAProvider.ts`
- Modify: `src/providers/NVIDIAClient.ts`
- Modify: `tests/providers/NVIDIAClient.test.ts`
- Modify: `tests/providers/NVIDIAProvider.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- Hosted NVIDIA remains unknown/observe-only and receives no undocumented field.
- An explicitly configured self-hosted NIM endpoint can declare a validated
  reporting dialect without claiming the CLI enabled server prefix caching.
- Terminal SSE usage is retained when streaming is enabled.
- Opportunistic cache fields remain partial unless the deployment selected a
  validated dialect.
- Hosted, self-hosted default, unsupported, and off payloads match their goldens.
- No dollar savings are calculated without catalog rates.

**Implementation**

- Separate hosted endpoint classification from self-hosted deployment
  capability.
- Preserve usage from streaming terminal events.
- Never send a portable request control for an admin-only NIM setting.

**Focused validation**

```bash
bun test tests/providers/NVIDIAClient.test.ts tests/providers/NVIDIAProvider.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Keep NVIDIA cache reporting deployment-aware and conservative`

**Exit criteria**

- Hosted API support is not inferred from NIM documentation.
- Streaming usage no longer disappears.

### Task 21: Add honest local-provider and extension compatibility

**Files**

- Modify: `src/providers/OllamaProvider.ts`
- Modify: `src/providers/LlamaCppProvider.ts`
- Modify: `src/providers/MLXProvider.ts`
- Modify: `src/extensions/ExtensionRuntimeHost.ts`
- Modify: `tests/providers/OllamaProvider.test.ts`
- Modify: `tests/providers/LlamaCppProvider.test.ts`
- Modify: `tests/providers/MLXProvider.test.ts`
- Modify: `tests/extensions/ExtensionRuntimeHost.test.ts`
- Modify: `tests/providers/promptCaching.test.ts`

**Failing tests first**

- Ollama terminal `prompt_eval_count`/`eval_count` feed ordinary usage but cache
  status remains not-supported/not-reported.
- llama.cpp and MLX parse compatible nested cached tokens only when present.
- Local hits have no dollar cost or savings unless an explicit external catalog
  says otherwise.
- No local adapter sends an undocumented cache control.
- Existing extension providers compile and run without new fields.
- An extension may opt into a validated capability and return optional normalized
  cache usage.
- Omitted extension request purpose disables controls.
- Unsupported/off payloads remain baseline-equivalent.

**Implementation**

- Correct ordinary Ollama terminal accounting.
- Add conservative observation to llama.cpp and MLX.
- Keep extension contracts additive and optional.
- Validate extension capability descriptors before use.

**Focused validation**

```bash
bun test tests/providers/OllamaProvider.test.ts tests/providers/LlamaCppProvider.test.ts tests/providers/MLXProvider.test.ts tests/extensions/ExtensionRuntimeHost.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Expose conservative local and extension cache accounting`

**Exit criteria**

- Local server reuse is not mislabeled as billed provider savings.
- Existing extensions remain source- and runtime-compatible.

### Phase 3 gate

```bash
bun test tests/providers
bun run typecheck
bun lint
CI=true bun run proof
```

Review the provider matrix line by line. Every row must have a capability fixture,
an off/no-op fixture, a usage fixture, and an explicit live-evidence state.

## Phase 4 — Diagnostics, UI, and Public Consumers

### Task 22: Add evidence-based diagnostics, redaction canaries, and overhead proof

**Files**

- Create: `src/core/agent/PromptCacheDiagnostics.ts`
- Modify: `src/core/agent/PromptCacheCoordinator.ts`
- Modify: `src/core/agent/AgentSessionAccounting.ts`
- Modify: `src/core/errorLogger.ts`
- Modify: `src/providers/errors.ts`
- Create: `tests/core/agent/PromptCacheDiagnostics.test.ts`
- Modify: `tests/security/promptCacheRedaction.test.ts`
- Create: `scripts/benchmark-prompt-cache.ts`
- Add a package script for the benchmark only if repository convention requires it

**Failing tests first**

- Diagnostics compare only requests with the same provider, endpoint class, API
  mode, model domain, epoch, purpose, and complete usage.
- Request, comparable-prefix, and session hit rates use their distinct formulas.
- Partial requests contribute to reporting coverage but not a precise aggregate
  rate.
- The possible-miss value is labeled as a heuristic upper bound.
- TTL expiry, downgrade, compaction, branch, mode, and tool changes suppress false
  miss notices.
- Provider writes caused by cross-region routing are not labeled a local prefix
  bug.
- Cache key, secret, credential-scope value, and prefix-signature canaries never
  appear in logs, provider errors, sessions, sync, telemetry, hooks, share/export,
  or reports. Raw session/prompt/path canaries are asserted absent from new cache
  metadata, provider cache-key fields, and rendered cache errors; existing
  legitimate transcript/hook/provider flows are explicitly excluded.
- Benchmark setup proves no network call is added and records p50/p95 local time.

**Implementation**

- Keep diagnostics pure over sanitized snapshots.
- Default miss notices off.
- Emit structured reasons only when evidence supports them.
- Redact verified cache parameter names/values from provider error output.
- Add a deterministic benchmark with warmed-up iterations and a documented 2 ms
  p95 release threshold; do not make a noisy workstation timing assertion part
  of ordinary unit tests.

**Focused validation**

```bash
bun test tests/core/agent/PromptCacheDiagnostics.test.ts tests/security/promptCacheRedaction.test.ts
bun run benchmark:prompt-cache
bun run typecheck
bun lint
git diff --check
```

Use the actual package-script name if repository review chooses a different stable
name.

**Commit**

- Message: `Add bounded prompt cache diagnostics and identity redaction`

**Exit criteria**

- Diagnostics describe evidence, never guessed root cause or savings.
- Local coordination meets the release overhead budget.

### Task 23: Expose one usage snapshot through CLI and Ink

**Files**

- Modify: `src/core/agent/AgentSessionAccounting.ts`
- Modify: `src/core/agent/AgentFormatter.ts`
- Modify: `src/core/agent/AgentUIRuntime.ts`
- Modify: `src/core/agent/AgentDependencyComposer.ts`
- Modify: `src/core/slashCommandTypes.ts`
- Modify: `src/core/slashCommandHandler.ts`
- Modify: `src/commands/usage.ts`
- Modify: `src/commands/status.ts`
- Modify: `src/commands/session.ts`
- Modify: `src/commands/statusline.ts`
- Modify: `src/ui/ink/InkRenderer.tsx`
- Modify: `src/ui/ink/AgentUI.tsx`
- Create/extend as required by project policy:
  `src/testing/drivers/ink-driver.ts`,
  `src/testing/drivers/pty-driver.ts`,
  `src/testing/scenarios/prompt-cache-usage.ts`,
  `src/testing/assertions/prompt-cache-usage.ts`
- Modify: `tests/core/agent/tokenUsageStatus.live.test.ts`
- Modify: `tests/core/tokenUsageStatus.format.test.ts`
- Modify: `tests/commands/usage.test.ts`
- Modify: `tests/commands/statusline.test.ts`
- Modify: `tests/ui/ink/StatusLine.test.tsx`
- Modify: `tests/ui/ink/InkRenderer.test.ts`
- Create: `tests/tuistory/prompt-caching.tuistory.test.ts`

**Failing tests first**

- Status, `/usage`, `/status`, `/session`, Plain, and Ink consume the same immutable
  usage snapshot.
- With no reported metrics or feature off, existing strings/snapshots are
  unchanged.
- Reported metrics show logical input, output, reads, writes, hit rate, coverage,
  cost provenance, and confidence without double-counting.
- A missing metric renders unknown/unavailable, not `0` or `0%`.
- Narrow terminals retain essential input/output/context information and degrade
  cache detail cleanly.
- Cumulative session activity is distinct from the latest context occupancy.
- Ink and Plain render equal semantic values.
- Real PTY/Tuistory drives a two-turn mocked reported-cache session, keyboard
  input, `/usage`, narrow resize/snapshot, Ctrl+C, and clean process exit.
- The PTY driver exposes `launch`, `type`, `enter`, `up`, `down`, `ctrlC`, and
  `snapshot` as required by repository policy.

**Implementation**

- Add one typed usage snapshot and formatter.
- Preserve the public status-line `metrics` segment and string fallback.
- Show compact `R`, `W`, and `CH` fields only when space and evidence allow.
- Make `/usage` the detailed source for reporting coverage and cost provenance.
- Keep activity heatmaps on logical tokens.
- Put all terminal automation helpers under `src/testing/`.

**Focused validation**

```bash
bun test tests/core/agent/tokenUsageStatus.live.test.ts tests/core/tokenUsageStatus.format.test.ts tests/commands/usage.test.ts tests/commands/statusline.test.ts tests/ui/ink/StatusLine.test.tsx tests/ui/ink/InkRenderer.test.ts
bun run build
bun run test:tuistory -- tests/tuistory/prompt-caching.tuistory.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Present cache usage consistently across CLI and Ink surfaces`

**Exit criteria**

- UI absence is quiet and backward-compatible.
- Visible TUI behavior has both Ink and real-terminal proof.

### Task 24: Extend RPC, ACP, browser, and mobile DTOs additively

**Files**

- Modify: `src/modes/rpc/types.ts`
- Modify: `src/modes/rpc/protocol.ts`
- Modify: `src/modes/rpc/adapter.ts`
- Modify: `src/modes/acp/types.ts`
- Modify: `src/modes/acp/adapter.ts`
- Modify: `src/browser/chrome.ts`
- Modify: `src/mobile/MobileHandoffClient.ts`
- Modify: `src/mobile/MobileRelay.ts`
- Modify: `src/core/agent.ts`
- Modify: `tests/modes/rpc/types.spec.ts`
- Modify: `tests/modes/rpc/protocol.spec.ts`
- Modify: `tests/modes/rpc/hookLifecycle.integration.test.ts`
- Modify: `tests/modes/acp/types.test.ts`
- Modify: `tests/modes/acp/adapter.test.ts`
- Modify: `tests/browser/chrome.spec.ts`
- Modify: `tests/mobile/MobileHandoffClient.test.ts`
- Modify: `tests/mobile/MobileRelay.test.ts`
- Modify: `tests/mobile/AgentMobileTurnLifecycle.test.ts`

**Failing tests first**

- Existing required RPC/ACP/mobile fields and legacy fixtures remain unchanged.
- Optional request/turn/session usage carries cache breakdown, reporting coverage,
  and cost confidence.
- Standard ACP messages stay standard; Autohand cache data uses optional extension
  data only.
- Old consumers ignore all new fields.
- Browser/mobile use the canonical session snapshot rather than recomputing.
- No cache identity material appears in any DTO.
- Partial usage and absent usage round-trip distinctly.

**Implementation**

- Add version-safe optional DTO fields.
- Reuse the canonical formatter/snapshot from Task 23.
- Preserve adapter IDs and wire compatibility.
- Do not overload context-estimation fields with billed provider usage.

**Focused validation**

```bash
bun test tests/modes/rpc tests/modes/acp tests/browser/chrome.spec.ts tests/mobile
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Expose optional cache usage through client transport contracts`

**Exit criteria**

- Older clients continue working.
- External IDs and provider cache identities remain separate.

### Task 25: Extend hooks, sync, telemetry, share, and export safely

**Files**

- Modify: `src/core/HookManager.ts`
- Modify: `src/telemetry/TelemetryClient.ts`
- Modify: `src/telemetry/TelemetryManager.ts`
- Modify: `src/telemetry/types.ts`
- Modify: `src/sync/SyncApiClient.ts`
- Modify: `src/sync/SyncService.ts`
- Modify: `src/sync/types.ts`
- Modify: `src/core/slashCommandHandler.ts`
- Modify: `src/share/types.ts`
- Modify: `src/share/sessionSerializer.ts`
- Modify: `src/commands/share.ts`
- Modify: `src/session/exportSession.ts`
- Modify: `src/commands/export.ts`
- Modify: `tests/hookManager.spec.ts`
- Modify: `tests/rpcHooks.spec.ts`
- Modify: `tests/telemetry/TelemetryClient.test.ts`
- Modify: `tests/telemetry/TelemetryManager.test.ts`
- Modify: `tests/core/agentSessionSync.spec.ts`
- Modify: `tests/sync/integration.test.ts`
- Modify: `tests/sync/pathSafety.test.ts`
- Modify: `tests/share/sessionSerializer.test.ts`
- Modify: export tests adjacent to session/autoresearch exports
- Modify: `tests/security/promptCacheRedaction.test.ts`

**Failing tests first**

- Hook fields are optional and additive.
- Telemetry validators accept aggregate cache counters/capability state but reject
  identity-shaped or oversized values.
- Opt-out sends no telemetry as before.
- Sync includes compatible aggregate usage only; it excludes ledger detail,
  secret state, continuity state, keys, and prefix signatures.
- Session sync explicitly excludes `usage.jsonl`, rolled usage segments, and
  ledger lock/checkpoint files even though `sessions/` is otherwise sync-enabled.
- Share/export may include aggregate usage and cost provenance, never cache
  identity.
- Canary values do not appear anywhere in serialized outputs.
- A server rejecting the new optional telemetry/sync schema fails soft locally.
- Legacy serialized sessions remain readable.

**Implementation**

- Version outbound telemetry/sync payloads where the receiver validates strictly.
- Keep operational fields aggregate-only and bounded.
- Use the shared cost estimator and usage snapshot.
- Apply allowlist serialization rather than broad object spreading.

**Focused validation**

```bash
bun test tests/hookManager.spec.ts tests/rpcHooks.spec.ts tests/telemetry tests/core/agentSessionSync.spec.ts tests/share tests/security/promptCacheRedaction.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Propagate aggregate cache usage without exporting cache identity`

**Exit criteria**

- Privacy boundaries are enforced by serializers and canary tests.
- Remote schema drift cannot disable local completions.

## Phase 5 — Documentation, Live Proof, and Promotion

### Task 26: Document configuration, providers, costs, and privacy

**Files**

- Create: `docs/prompt-caching.md`
- Modify: `docs/providers.md`
- Modify: `docs/features.md`
- Modify: `docs/model-catalog.md`
- Modify: `docs/telemetry.md`
- Modify: `docs/hooks.md`
- Modify: `docs/rpc-protocol.md`
- Modify: `docs/config-reference.md`
- Modify: every existing `docs/config-reference_*.md`
- Modify: `config.example.json`
- Modify: `src/commands/settings.ts`
- Modify: `src/i18n/locales/*.json`
- Modify: `README.md` only when a public production control is promoted
- Create: `tests/docs/promptCachingDocs.test.ts`
- Modify: `tests/commands/settings.test.ts`
- Modify: `tests/i18n/i18n.test.ts`

**Failing tests first**

- Every config reference documents mode, retention, metrics, miss notices, gate
  precedence, automatic-provider caveat, and extended-retention privacy warning.
- JSON, YAML, and TOML examples remain equivalent.
- Provider docs show controlled, automatic, observe-only, unsupported, and
  unverified states by API mode.
- Docs never equate cache hits with guaranteed savings.
- Docs explain that off cannot disable provider-managed automatic caching or purge
  existing remote state.
- All locales contain required settings/help keys and dependency floors remain
  Ink `>=7` and React `>=19`.
- Main README makes no production claim before a verified allowlist exists.

**Implementation**

- Make `docs/prompt-caching.md` the canonical user guide.
- Link to provider primary references and date the matrix.
- Explain local secret/continuity storage and what never syncs.
- Document ledger detail retention, aggregate retention, diagnostics, and failure
  behavior.
- Generate/update localized references through the repository's translation
  workflow; do not leave English-only config behavior.

**Focused validation**

```bash
bun test tests/docs/promptCachingDocs.test.ts tests/commands/settings.test.ts tests/i18n/i18n.test.ts
bun run typecheck
bun lint
git diff --check
```

**Commit**

- Message: `Document prompt caching controls evidence and privacy boundaries`

**Exit criteria**

- Configuration behavior is discoverable in every supported reference.
- Provider support wording matches evidence, not intention.

### Task 27: Build the sanitized live-probe harness and evidence registry

**Files**

- Create: `scripts/probe-prompt-cache.ts`
- Create: `src/providers/promptCacheProbe.ts` only if shared parsing cannot remain
  script-local and testable
- Create: `tests/providers/promptCacheProbe.test.ts`
- Create: `docs/evidence/prompt-caching/README.md`
- Create/update: sanitized JSON artifacts under
  `docs/evidence/prompt-caching/`
- Modify: `src/providers/promptCaching.ts` only for cells that pass evidence
- Modify: `docs/prompt-caching.md` and `docs/providers.md` to reflect results
- Add a package script with an explicit stable name

**Failing tests first**

- A fake two-turn provider verifies stable prefix/key reuse and sanitized usage
  extraction without exposing request content.
- Output schema includes provider, endpoint class, API mode, model, timestamp,
  probe version, automatic/affinity/breakpoint capabilities, retention, result,
  reporting coverage, and latency.
- Raw keys, credentials, prompt text, response text, account IDs, and secret query
  parameters are rejected/redacted before artifact write.
- Three runs across two fresh opaque scopes are required for initial control proof.
- Artifacts expire after 30 days or relevant API/model/transport version change.
- A failed, unsupported, unreported, or environment-blocked run cannot enable a
  production capability cell.
- Candidate controls require an explicit script-only override that normal CLI
  config and agent requests cannot select.
- Expired evidence automatically resolves the runtime cell to observe-only.
- Probe errors remain sanitized and return a nonzero status where appropriate.

**Implementation**

- Use configured providers without printing credential values.
- Generate a synthetic stable prefix above the documented minimum and a volatile
  suffix; never use repository/user prompt content.
- Record only sanitized measurements.
- Require an explicit `--provider`, `--model`, and API-mode selection; do not probe
  every configured provider accidentally.
- Require `--candidate-control` to exercise an unverified serializer, restrict it
  to the synthetic probe path, and never persist it in config.
- Add a verified allowlist entry only in the same commit as its current passing
  artifact.
- Record environment-blocked honestly when credentials/network are unavailable.

**Focused validation**

```bash
bun test tests/providers/promptCacheProbe.test.ts tests/providers/promptCaching.test.ts
bun run typecheck
bun lint
git diff --check
```

Then, for each explicitly authorized configured cell:

```bash
bun run probe:prompt-cache -- --provider <provider> --model <model> --api-mode <mode> --candidate-control
```

Use the actual package-script name selected during implementation.

**Commit**

- Message without live promotions: `Add sanitized prompt cache live-proof harness`
- Message for each separately promoted cell:
  `Verify prompt caching for <provider> <API mode> <model family>`

**Exit criteria**

- Every production-controlled cell has current evidence.
- Unavailable credentials leave a documented blocker, not a support claim.

### Task 28: Run final release proof and record the rollout decision

**Files**

- Update only documentation/evidence that reports the actual final result.
- Do not repair unrelated failures inside this task.

**Full validation, in order**

```bash
git status --short
git diff --check
bun test
bun lint
bun run typecheck
bun run build
bun run test:tuistory
bun run benchmark:prompt-cache
CI=true bun run proof
```

**Manual/evidence review**

- Compare every provider matrix row to its fixtures and live-evidence state.
- Confirm feature-off golden payloads and headers for every adapter/API mode.
- Confirm all internal `.complete()` call sites declare purpose.
- Inspect session, log, sync, telemetry, hook, share/export, and report artifacts
  with security canaries.
- Exercise the kill switch and exact-field downgrade once.
- Verify new/clear/resume/attach/fork/clone/import across applicable clients.
- Check narrow/wide terminal display, Ctrl+C, and clean exit.
- Confirm Ink is still `>=7` and React is still `>=19`.

**Rollout decision**

Record one result per capability cell:

- `controlled-and-measured` — fixtures plus current live proof;
- `automatic-and-observed` — provider-managed behavior plus current live usage;
- `observe-only` — safe parsing but no request mutation claim;
- `unsupported-or-unobservable` — no honest portable contract;
- `environment-blocked` — implementation is ready but live proof is unavailable.

Stage 0 observation may ship with no controlled cells. Stage 1 may enable only
the individually verified cells. Default-on Stage 3 is a separate rollout change
after a separately approved consented internal-canary program supplies the
7-day/1,000-request thresholds, control group, backend schema, retention policy,
and owner in the design; extended retention remains opt-in.

**Commit**

- If and only if validation/evidence documentation changed, message:
  `Record prompt caching release evidence and rollout state`

**Exit criteria**

- Full proof is green or every blocker is attributed with exact command/evidence.
- No provider is promoted beyond its proof.
- The emergency gate and user off switch remain available.

## Final Definition of Done

- Tasks 0–28 are complete or explicitly deferred with an observe-only state.
- Every built-in/custom/extension provider path has an executable capability
  classification and negative no-op coverage.
- Cache usage is correct across streaming, non-streaming, retries, partials,
  sessions, branches, and auxiliary calls.
- Provider request mutation is limited to current, dated, live-proven cells.
- The scoped derived key appears only in its allowlisted provider field; secret
  and continuity state appear only in the protected local store, and no cache
  identity enters other persistence or operational surfaces.
- User docs, localized config references, CLI, Ink, RPC, ACP, browser, mobile,
  hooks, sync, telemetry, share, and export agree on the same semantics.
- Tests, lint, typecheck, build, real-terminal tests, benchmark, and
  `CI=true bun run proof` pass.

## STOP Conditions

Stop the current task and resolve the contract before continuing when:

- a field, error code, TTL, price, or metric meaning lacks current primary-source
  or endpoint-fixture evidence;
- feature-off payload/header goldens change;
- a missing metric would render as zero;
- a provider-reported legacy total would be silently redefined;
- a cache key could contain raw local, user, prompt, credential, or account data;
- an extension/custom endpoint would receive an implicit nonstandard field;
- fallback would replay usable output or exceed the logical attempt budget;
- a public protocol requires a breaking field;
- a branch inherits spent activity as new usage;
- a live artifact contains unsanitized content;
- a provider would be called supported from mocks alone;
- Ink or React would be downgraded;
- unrelated dirty worktree changes cannot be preserved safely.
