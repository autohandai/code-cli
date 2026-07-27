# OptMem Memory Design Notes

Placed in `docs/` because this repo already keeps design-analysis notes there, for example `docs/shell-tool-analysis.md` and `docs/cc-src-tool-gap-analysis.md`. There is no existing memory-design note to extend.

Reviewed on 2026-07-27. Primary sources only:
- Current CLI memory implementation: `src/memory/MemoryManager.ts`, `src/memory/types.ts`, `src/core/context/summarizer.ts`, `src/commands/memory.ts`
- OptMem repository README/source/tests: <https://github.com/VictorTaelin/OptMem>, <https://github.com/VictorTaelin/OptMem/blob/main/memo>, <https://github.com/VictorTaelin/OptMem/blob/main/test.py>
- No linked paper was present in the OptMem README or repo root on 2026-07-27.

## Executive Summary

OptMem is not a vector-memory system. It is an append-only event log plus a deterministic binary summary tree. Autohand now adopts that same source-of-truth boundary: the immutable event log is canonical, while entry JSON, indexes, and summaries are projections.

What does not map cleanly is OptMem's human-in-the-loop `nap` flow, regex-only retrieval, and the assumption that memories are one-line immutable records. This CLI already has mutable JSON entries, tag search, and automatic summarization; replacing that contract would break compatibility for `/memory`, `save_memory`, `recall_memory`, sync, and existing tests.

## Current CLI Baseline

The CLI keeps one JSON file per current memory entry for compatibility and updates an existing entry when token-overlap similarity reaches `0.6` in [`src/memory/MemoryManager.ts`](../src/memory/MemoryManager.ts). Every snapshot, create, update, and delete is also recorded in `.autohand/memory/events/LOG.jsonl`, which is the canonical history used to repair those JSON projections.

The public compatibility contract remains additive:
- keep `MemoryEntry` JSON files and current `MemoryManager` methods available
- preserve `/memory`, `save_memory`, and `recall_memory` while adding outline, zoom, rebuild, and canonical deletion
- treat JSON entries, indexes, and summary trees as rebuildable views of the canonical event history

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
| Adopted | Canonical append-only event log for memory writes and updates | Gives auditability, crash recovery, convergent sync, and rebuildable compatibility views. |
| Adopted | Rebuildable summary cache separate from canonical memory entries | Matches current context-compaction needs and avoids destructive edits to user-visible memories. |
| Adopted | Explicit corruption recovery path for derived memory artifacts | `forget` invalidates derived data explicitly instead of silently changing canonical memory. |
| Adopted | Strong invariants and crash/concurrency tests | Coverage includes torn writes, duplicate events, output caps, snapshot stability, sync merges, and rebuild behavior. |
| Avoid now | Human-authored `nap` as the only compaction path | This CLI already auto-summarizes. Forcing manual compaction would slow normal flows and break expectations. |
| Avoid now | Regex-only retrieval and no semantic ranker | Too weak for project/user memory retrieval in a TypeScript CLI with broader use cases. |
| Avoid now | Replacing current JSON memory files with fixed-width records | Would disrupt `/memory`, sync, existing tests, and any external assumptions about `.autohand/memory/`. |
| Adopted | Hierarchical `outline` and `zoom` over memory summaries | Available through `/memory` and `inspect_memory` without replacing `recall_memory`. |
| Adopted | Snapshot-stable bounded wake equivalent for long memory injections | Context injection uses a stable event-count snapshot with explicit line and character budgets. |
| Adopted | Recency-aware retrieval combined with content and tag relevance | `recall_memory` preserves its output contract while ranking relevant current entries. |

## Staged Proposal That Preserves Current Compatibility

### Implementation status

Stages 0 through 3 are implemented:

- every user/project root keeps its canonical history at `memory/events/LOG.jsonl`
- the first initialization snapshots legacy JSON entries before recording new events
- create, update, and delete events are serialized under cross-process locks
- incomplete trailing records are truncated before the next append, while corrupt complete records fail explicitly
- memory entry and index JSON files use atomic replacement and are repaired from canonical events during startup or explicit rebuild
- global event histories participate in settings sync and are merged by event ID; locks and derived summaries are excluded
- deterministic binary summary snapshots live under `memory/derived/summaries/`, enforce line/character budgets, retain a bounded set of recent snapshots, and can be invalidated without touching canonical data
- `getContextMemories()` switches large memory sets to bounded outlines
- `recall_memory` ranks content, tag, and recency matches
- `inspect_memory` and `/memory outline|zoom|forget|rebuild|delete` expose the lifecycle without replacing existing flat-list behavior

The write order is event first, then materialized JSON and index. A crash can therefore leave a projection behind the log, but cannot create an unrecorded committed mutation. Replaying the log repairs projections. Derived summaries are always cache, never source of truth.

### Stage 0: Safety-first hardening

- Keep the current `MemoryManager` API and `.autohand/memory/*.json` files unchanged.
- Add torn-write detection and repair for any new derived-memory artifacts.
- Add tests modeled on OptMem's primary invariants:
  - parallel writes never collide on identity
  - trailing partial records are repaired before the next append
  - derived summaries can be invalidated and rebuilt
  - output injected into model context respects explicit byte/line budgets

### Stage 1: Canonical append-only log

- On every `store()`, `updateMemory()`, and `delete()`, append a canonical `create`, `update`, or `delete` event.
- Keep the JSON entry as the materialized latest state.
- Use the event log as canonical history and JSON as the compatibility read projection.

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

- Build a summary tree from a stable replay of canonical events.
- Use it only for `getContextMemories()` and future compaction helpers.
- Make invalidation non-destructive: delete derived summary nodes and recompute them, never delete raw memory entries.

This is the OptMem idea worth copying most directly: summaries are cache, not source of truth.

### Stage 3: Inspection and retrieval upgrades

- Add agent-tool and slash-command views for hierarchical memory inspection similar to `zoom`.
- Preserve current `recall_memory` response fields while layering in content, tag, and recency ranking.
- Keep `/memory` as the human-readable latest-state view, not the append-only event stream.

## Evaluation Ideas To Reuse

OptMem's `test.py` is unusually concrete. The best ideas to port are:

- Structural invariants for the summary cover: bounded line count, full span coverage, and monotonic increase in detail toward the present. Source: [`test.py` block math](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L50-L80)
- Harness-budget tests: every emitted part must fit declared char/line limits. Source: [`test.py` pagination checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L226-L248)
- Append-only and corruption recovery tests. Source: [`test.py` append-only, race, torn-write, and corrupt-summary checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L249-L256), [`L403-L518`](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L403-L518)
- Snapshot-stability tests: a read started at logical time `T` should not shift because later writes arrive mid-read. Source: [`cmd_wake` snapshot argument and tests](https://github.com/VictorTaelin/OptMem/blob/main/memo#L504-L571), [`test.py` mid-wake stability checks](https://github.com/VictorTaelin/OptMem/blob/main/test.py#L383-L398)

## Recommended Direction

Implemented direction: borrow OptMem's storage discipline and test discipline while preserving Autohand's existing interaction model.

Specifically:
- adopt immutable event recording under the current memory layer
- treat summaries as rebuildable derived state
- add explicit corruption recovery and concurrency tests
- expose bounded outline/zoom views without making them mandatory for normal recall

This gives the robustness and navigation benefits without creating a second memory source of truth.
