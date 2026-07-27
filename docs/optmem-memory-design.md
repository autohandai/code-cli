# OptMem Memory Design Notes

Placed in `docs/` because this repo already keeps design-analysis notes there, for example `docs/shell-tool-analysis.md` and `docs/cc-src-tool-gap-analysis.md`. There is no existing memory-design note to extend.

Reviewed on 2026-07-27. Primary sources only:
- Current CLI memory implementation: `src/memory/MemoryManager.ts`, `src/memory/types.ts`, `src/core/context/summarizer.ts`, `src/commands/memory.ts`
- OptMem repository README/source/tests: <https://github.com/VictorTaelin/OptMem>, <https://github.com/VictorTaelin/OptMem/blob/main/memo>, <https://github.com/VictorTaelin/OptMem/blob/main/test.py>
- No linked paper was present in the OptMem README or repo root on 2026-07-27.

## Executive Summary

OptMem is not a vector-memory system. It is an append-only event log plus a deterministic binary summary tree. The useful ideas for this CLI are the immutable raw log, summary-cache invalidation via `forget`, explicit wake/part contracts, and the strong crash/concurrency test suite.

What does not map cleanly is OptMem's human-in-the-loop `nap` flow, regex-only retrieval, and the assumption that memories are one-line immutable records. This CLI already has mutable JSON entries, tag search, and automatic summarization; replacing that contract would break compatibility for `/memory`, `save_memory`, `recall_memory`, sync, and existing tests.

## Current CLI Baseline

Today the CLI stores one JSON file per memory entry and updates an existing entry when token-overlap similarity reaches `0.6` in [`src/memory/MemoryManager.ts`](../src/memory/MemoryManager.ts). Retrieval is substring/tag search plus simple recency ordering, and `getContextMemories()` injects the most recent entries rather than a navigable summary structure. Context summarization can also persist extracted facts back into project memory through [`src/core/context/summarizer.ts`](../src/core/context/summarizer.ts).

That means any OptMem-inspired work should be additive:
- keep `MemoryEntry` JSON files and current `MemoryManager` methods as the public compatibility layer
- avoid changing `/memory`, `save_memory`, `recall_memory`, or sync storage layout in the first stage
- treat any append-only log or summary tree as an internal sidecar index

## Concrete Mechanisms

| Area | OptMem mechanism | Source | Applicability here |
| --- | --- | --- | --- |
| Zoom / recall | `wake` builds a bounded, recency-weighted cover of aligned power-of-two blocks; recent items stay raw, older items collapse into summaries. `zoom` opens one block into its two halves. `recall` scans the raw append-only log with regex and returns only the newest matches that fit the output cap. | [`cover()` and `_cover()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L65-L112), [`cmd_wake`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L504-L571), [`cmd_recall`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L646-L674), [`cmd_zoom`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L676-L697) | Adopt the hierarchical summary view, not regex-only recall. For this CLI, keep current search APIs and add an optional "memory outline" built from append-only events plus summaries. |
| Adding / updating | New memories are appended to fixed-width `LOG.txt` records under a file lock; IDs come from log position. There is no in-place semantic update of a memory fact. Summaries are written separately to `TREE/` as cache records. | [`log_append`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L274-L307), [`README` file layout](https://github.com/VictorTaelin/OptMem/blob/main/README.md#L29-L52) | Adopt immutable event recording internally. Avoid replacing current `updateMemory()` behavior immediately; instead, write append-only change events and continue materializing the latest JSON view for compatibility. |
| Discarding / compaction | Compaction is explicit and incremental. `nap` builds one pending block at a time, in order. `forget` deletes cached summaries upward from a block, but never edits the raw log. `wake` refuses only when a required summary is missing. | [`pending()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L368-L390), [`nap_prompt()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L392-L422), [`cmd_nap`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L584-L610), [`cmd_forget`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L634-L644) | Strong fit. The key idea is reversible compaction: delete or recompute summaries without deleting source facts. For this CLI, compaction should operate on derived context views, not on canonical memory entries. |
| Relevance scoring | There is no embedding score or semantic ranker. Relevance comes from structural recency in `wake`, exact/regex match in `recall`, and user or agent-guided navigation with `zoom`. | [`README` commands + prompt](https://github.com/VictorTaelin/OptMem/blob/main/README.md#L8-L27), [`cmd_recall`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L646-L674) | Avoid copying this as-is. This CLI already needs better semantic dedupe and retrieval than substring matching. The useful lesson is that recency and navigability should remain first-class even if semantic ranking is added later. |
| Safety / robustness | The store refuses to create a new identity accidentally, uses exclusive locks, repairs torn trailing records, validates block shape, validates UTF-8 and import dates, surfaces corrupt summaries as `forget` recovery paths, and keeps config changes non-destructive. | [`store()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L115-L132), [`repair()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L200-L210), [`block_id()` and `check()`](https://github.com/VictorTaelin/OptMem/blob/main/memo#L342-L366), [`test.py` concurrency/crash checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L403-L518) | Strong fit. These are the highest-signal ideas to borrow for a CLI memory system because they reduce corruption and accidental divergence without changing UX contracts. |

## Adopt / Avoid / Later

| Recommendation | What | Why |
| --- | --- | --- |
| Adopt now | Append-only sidecar event log for memory writes and updates | Gives auditability, crash recovery, and rebuildable derived views without breaking current JSON entry reads. |
| Adopt now | Rebuildable summary cache separate from canonical memory entries | Matches current context-compaction needs and avoids destructive edits to user-visible memories. |
| Adopt now | Explicit corruption recovery path for derived memory artifacts | OptMem's `forget` model is better than silent fallback when summaries are blank or torn. |
| Adopt now | Strong invariants and crash/concurrency tests | OptMem's tests are more valuable than the exact storage format; this repo should validate torn writes, duplicate IDs, output caps, and rebuild behavior. |
| Avoid now | Human-authored `nap` as the only compaction path | This CLI already auto-summarizes. Forcing manual compaction would slow normal flows and break expectations. |
| Avoid now | Regex-only retrieval and no semantic ranker | Too weak for project/user memory retrieval in a TypeScript CLI with broader use cases. |
| Avoid now | Replacing current JSON memory files with fixed-width records | Would disrupt `/memory`, sync, existing tests, and any external assumptions about `.autohand/memory/`. |
| Later | Hierarchical `zoom` UI over memory summaries | Useful once a sidecar summary tree exists; it can become a power-user inspection tool without replacing `recall_memory`. |
| Later | Snapshot-stable multi-part "wake" equivalent for long memory injections | Worth adding only if memory context starts exceeding current prompt budgets regularly. |
| Later | Recency-aware retrieval that combines semantic hits with summary-tree navigation | Best follow-up once append-only events and derived summaries exist. |

## Staged Proposal That Preserves Current Compatibility

### Stage 0: Safety-first hardening

- Keep the current `MemoryManager` API and `.autohand/memory/*.json` files unchanged.
- Add torn-write detection and repair for any new derived-memory artifacts.
- Add tests modeled on OptMem's primary invariants:
  - parallel writes never collide on identity
  - trailing partial records are repaired before the next append
  - derived summaries can be invalidated and rebuilt
  - output injected into model context respects explicit byte/line budgets

### Stage 1: Append-only sidecar log

- On every `store()` and `updateMemory()`, append a sidecar event record such as `create`, `update`, `delete`, `summary-derived`.
- Keep the JSON entry as the materialized latest state.
- Use the sidecar log for audit/rebuild only; do not route existing reads through it yet.

Suggested internal layout:

```text
.autohand/memory/
  <existing entry>.json
  index.json
  events/
    LOG.jsonl
  derived/
    summaries/
```

### Stage 2: Derived summary tree for context injection

- Build a summary tree from sidecar events or canonical entries.
- Use it only for `getContextMemories()` and future compaction helpers.
- Make invalidation non-destructive: delete derived summary nodes and recompute them, never delete raw memory entries.

This is the OptMem idea worth copying most directly: summaries are cache, not source of truth.

### Stage 3: Optional inspection and retrieval upgrades

- Add an internal or slash-command debug view for hierarchical memory inspection similar to `zoom`.
- Preserve current `recall_memory` behavior, then layer in recency-aware ranking and optional semantic retrieval.
- Keep `/memory` as the human-readable latest-state view, not the append-only event stream.

## Evaluation Ideas To Reuse

OptMem's `test.py` is unusually concrete. The best ideas to port are:

- Structural invariants for the summary cover: bounded line count, full span coverage, and monotonic increase in detail toward the present. Source: [`test.py` block math](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L50-L80)
- Harness-budget tests: every emitted part must fit declared char/line limits. Source: [`test.py` pagination checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L226-L248)
- Append-only and corruption recovery tests. Source: [`test.py` append-only, race, torn-write, and corrupt-summary checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L249-L256), [`L403-L518`](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L403-L518)
- Snapshot-stability tests: a read started at logical time `T` should not shift because later writes arrive mid-read. Source: [`cmd_wake` snapshot argument and tests](https://github.com/VictorTaelin/OptMem/blob/main/memo#L504-L571), [`test.py` mid-wake stability checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L383-L398)

## Recommended Direction

Recommended path: borrow OptMem's storage discipline and test discipline, not its full interaction model.

Specifically:
- adopt immutable event recording under the current memory layer
- treat summaries as rebuildable derived state
- add explicit corruption recovery and concurrency tests
- defer any user-facing `wake` or `zoom` UX until the sidecar summary tree proves useful

That gives most of the robustness upside while preserving today's TypeScript CLI contracts.
