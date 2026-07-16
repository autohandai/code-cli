# Plan 009: Replayable Autoresearch Ledger and Decision Engine

**Status:** BLOCKED: paired TypeScript SDK methods and events require changes outside `cli-3`
**Priority:** P1
**Effort:** XL
**Risk:** HIGH

## Summary

Extend `/autoresearch` so rejected candidates remain reproducible after leaving the working tree. Persist immutable candidate, evaluation, and decision records; support adaptive noisy measurements, multiple objectives, isolated replay, rescoring, comparison, Pareto analysis, and configurable artifact retention.

Only accepted experiments advance the Git lineage. Replay and rescoring append new records and never rewrite historical decisions or automatically change branches.

## Persistence and decision model

- Add a versioned `.auto/ledger/` containing:
  - `events.jsonl`: append-only candidate, evaluation, decision, pin, and prune records.
  - `objects/<sha256>`: deduplicated patches, untracked-file content, evaluator scripts, outputs, and manifests.
- Define Zod-backed discriminated record types with stable IDs, timestamps, schema versions, and extensible JSON context:
  - **Candidate:** base commit, parent attempt, binary Git patch, untracked files, changed paths/hashes, evaluator snapshot, environment fingerprint.
  - **Evaluation:** original/current evaluator mode, raw metric samples, median/MAD aggregates, checks, execution outcome, and drift warnings.
  - **Decision:** policy version, reference evaluation, constraint results, primary improvement, confidence score, outcome, and explanation.
- Keep `.auto/log.jsonl` as a backward-compatible summary projection. Existing sessions remain readable but are marked non-replayable when no candidate artifact exists.
- Require a clean Git repository for new replayable sessions. Capture a zero-diff baseline before allowing candidate edits; block on HEAD drift, out-of-scope changes, changed submodules, or unsafe paths.
- Capture tracked changes with a full binary patch and untracked regular files as content-addressed objects. Preserve symlink targets without following them.

## Evaluation policy

- Preserve existing `metricName`, `metricUnit`, and `direction` as the primary objective. Add optional secondary objectives and hard constraints.
- Each benchmark invocation must emit exactly one finite `METRIC <name>=<number>` value for every configured objective.
- Default adaptive sampling:
  - Start with three samples and add one sample at a time, up to nine.
  - Aggregate with median and MAD.
  - Compute signed primary improvement against the latest materialized accepted evaluation using a robust MAD-based noise band.
  - Accept when all constraints conservatively pass and confidence is at least `2.0`.
  - Reject when a constraint conclusively fails or the primary metric conclusively regresses.
  - Record `inconclusive` after the sample limit; revert it from the working tree but retain it in the ledger.
- Secondary objectives affect Pareto ranking but not automatic acceptance unless declared constraints.
- Rescoring appends a new decision using stored measurements and the current policy. It never changes the original decision or Git materialization state.

## Public interfaces

- Extend `/autoresearch` and both CLI aliases with:
  - `history` — list attempts, replayability, latest evaluation, decision, and materialization.
  - `replay <id> [--evaluator original|current]` — default to the frozen original evaluator.
  - `rescore <id>|--all` — apply the current policy without executing benchmarks.
  - `compare <a> <b>` — compare raw samples, aggregates, constraints, and decisions.
  - `pareto` — list non-dominated, constraint-passing candidates.
  - `pin|unpin <id>` — protect or release candidate artifacts from retention.
  - `prune [--dry-run|--yes]` — preview by default; delete artifacts only with explicit confirmation.
- Extend `init_experiment` with additive objective, sampling, retention, and safe environment-allowlist options.
- Make `run_experiment` capture the candidate and return `attemptId`, metric vectors, samples, and the engine decision.
- Make `log_experiment` accept `attemptId`; ledger-backed runs use the persisted decision rather than a model-supplied status. Preserve the legacy metric/status path for old sessions.
- Add `replay_experiment` and analysis tools through `ToolManager`/`ActionExecutor`, retaining existing permission, timeout, cancellation, and hook behavior.
- Add matching JSON-RPC methods, notifications, typed SDK methods, and event phases. Keep existing start/status/stop names and result fields compatible.
- Update dashboard and finalization output to show full history, Pareto candidates, replay drift, and newly recommended candidates without presenting them as committed winners.

## Replay, security, and retention

- Reconstruct candidates in a detached temporary Git worktree at the recorded base commit, apply the stored candidate, run the selected evaluator, persist results, then remove the worktree.
- “Original” replay freezes scripts and configuration, but only verifies environment compatibility. It does not restore arbitrary environment variables.
- Record a safe fingerprint: OS, architecture, CLI/Node/Bun/Git versions, lockfile hashes, evaluator/check hashes, and explicitly allowlisted non-secret variables.
- Reject secret-like environment names even if allowlisted. Never persist the complete process environment, credentials, or tokens.
- Support optional maximum artifact bytes and maximum artifact age; defaults are unlimited.
- Automatic retention may prune only unpinned rejected/inconclusive bulky objects, oldest first. Metadata and decisions are permanent. Accepted or pinned artifacts require explicit prune approval.
- Append an `artifact_pruned` record so lost replayability remains visible and explainable.

## Implementation sequence

1. Add failing schema, migration, clean-baseline, and candidate-capture tests.
2. Implement the versioned ledger, content-addressed object store, safe fingerprinting, and legacy projection.
3. Add failing adaptive sampling, constraints, inconclusive, rescoring, and Pareto tests; implement the deterministic decision engine.
4. Add isolated replay tests covering original/current evaluators, environment drift, binary/untracked files, cleanup, cancellation, and failure recovery.
5. Add CLI/tool surfaces test-first, then hooks, dashboard, finalization, documentation, and real Tuistory flows.
6. Add the RPC contract and paired TypeScript SDK methods/events, refresh bundled CLI binaries, and verify old clients still work.
7. Implement retention preview/enforcement, pinning, corruption recovery, and explicit prune confirmation.
8. Update `plans/README.md` with Plan 009 and complete the full validation gates.

## Test and acceptance criteria

- Ledger loading validates records and tolerates only a truncated final JSONL write; earlier corruption fails with an actionable error.
- Candidate capture round-trips text, binary, deletion, rename, executable, untracked, and symlink changes without escaping scope.
- Stable improvements accept; stable regressions reject; noisy overlaps sample adaptively and finish inconclusive when unresolved.
- Hard constraints fail closed; Pareto results are correct for mixed higher/lower objectives.
- Replay never changes the user's branch or working tree and always cleans temporary worktrees.
- Rescore preserves original records and cannot silently promote a rejected candidate into Git history.
- Pruning never removes metadata, pinned artifacts, or accepted artifacts automatically.
- Existing single-metric configs, `.auto/log.jsonl`, CLI commands, RPC methods, hooks, and SDK consumers remain compatible.
- Run targeted Autoresearch, command, tool, RPC, ACP, export/finalize, and Tuistory suites, followed by:
  - `bun run test`
  - `bun run lint`
  - `bun run proof`
  - SDK `bun run prepublishOnly`
  - bundled-runtime help and replay smoke tests

## Defaults and constraints

- Full decision engine is included in the first delivery.
- Primary metric plus hard constraints governs automatic acceptance; Pareto ranking is advisory.
- Adaptive sampling defaults to 3–9 samples and confidence threshold `2.0`.
- New replayable sessions require a clean Git repository; non-Git and dirty-baseline snapshots are out of scope.
- No new dependencies; use Node primitives, existing Zod, and existing command/runtime infrastructure.
- Commit title: `Preserve and replay autoresearch experiment decisions`
- Every commit must include the required Autohand Evolve co-author trailer.

## Completion record

The `cli-3` implementation is complete: targeted suites, `bun run test`, `bun run lint`,
`bun run proof`, all bundled binary builds, and bundled help/history/replay smoke tests pass.

The paired TypeScript SDK work and SDK `bun run prepublishOnly` remain blocked because the
SDK lives at `/Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript`, while
this project's AGENTS.md explicitly prohibits modifying files outside `cli-3`. The SDK
also has unrelated local changes that must be preserved. Existing start/status/stop RPC
clients remain compatible and are covered by the `cli-3` RPC regression suite.
