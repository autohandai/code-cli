# `read_file` Implementation Audit

Audit date: 2026-08-11.
Original bounded-read baseline: local `main` at `deceaeff`.
Stateful-read baseline: local `main` at `21da5dde`.
Normative contract: [README.md](./README.md).

## Baseline path

At the audited baseline, the model-visible tool schema was registered in `src/core/toolManager.ts`, calls were converted to `AgentAction` and executed by `src/core/actionExecutor.ts`, and the executor loaded text through `FileActionManager.readFile()` before applying line and size heuristics in memory.

## Implemented path

- `ToolManager` repairs only unambiguous read aliases and fully numeric non-negative integer strings before schema validation.
- `ActionExecutor` independently validates direct callers, preserves the zero-based offset contract, and formats one-based source labels plus actionable recovery notes.
- `FileActionManager.readFileWindow()` reuses the existing containment boundary, blocks pseudo-device paths before I/O, performs bounded read-only filename recovery, sniffs binary signatures, and delegates text to the streaming scanner in `src/actions/readFile.ts`.
- The scanner skips pre-offset content without accumulation, enforces the line, complete-response byte, and per-line ceilings without splitting UTF-8 code points, and hashes only complete valid-UTF-8 streams for read authorization.
- The legacy `readFile()` contract remains unchanged for mutation and compatibility callers.
- `ReadSessionLedger` owns bounded per-session revision, coverage, digest, and dedup-view state. `Session` persists that state atomically; new, cloned, and forked sessions do not inherit it.
- `ActionExecutor` resolves the three ordered feature flags, records only model-visible complete lines, consumes unchanged-read dedup records before returning a stub, and guards each direct file-mutation tool at its destructive target.
- Mutation authorization hashes the current raw file and distinguishes unread, partial, and stale state. New paths remain writable, permission bypass modes do not bypass the invariant, and `AUTOHAND_DISABLE_STATEFUL_READ=1` restores legacy behavior immediately.
- Preview acceptance verifies the captured original again before applying a pending change, so authorization cannot be followed by a blind stale overwrite.

## Finding-by-finding disposition

| Finding | Baseline evidence | Decision |
| --- | --- | --- |
| Three independent ceilings | The executor has a 2,000-line threshold and 80 KiB threshold, but no per-line clamp. Explicit `limit` can bypass the line threshold. | Adopt all three as hard output ceilings. |
| Recovery instead of silence | Empty files return an empty string. Past-EOF windows also return an empty string. Large-file output includes a continuation example. | Adopt explicit empty/EOF/truncation notes. |
| Read-before-write ledger | No model-view ledger exists. Peer awareness records only mtime for concurrent-session warnings. | Adopt behind ordered, restart-required, default-off experiments. Partial, clamped, and invalid-UTF-8 views do not authorize writes. |
| Self-expiring unchanged-read dedup | No unchanged-read result cache exists. | Adopt consume-on-hit records keyed by canonical file revision and exact requested window. |
| Filename normalization and suggestions | Existing `resolvePath()` enforces realpath containment but missing names fail without model-visible recovery. | Adopt bounded read-only recovery with containment rechecks. |
| Memory-capped streaming | `FileActionManager.readFile()` rejects files over 10 MiB and otherwise loads the entire file before the executor slices it. | Adopt a dedicated streaming window path while preserving full reads for mutation internals. |
| Images attach as image blocks | `ToolActionOutcome.output` is string-only; `read_file` decodes all admitted files as UTF-8. | Do not claim parity. Return truthful binary notes; design multimodal results separately. |
| Downscale coordinate disclosure | No `read_file` image attachment exists. | Not applicable until multimodal tool results exist. |
| Structured notebook rendering | `notebook_edit` exists, but `read_file` returns raw notebook JSON. | Defer as a document-rendering follow-up. |
| SVG text; binary/PDF notes | No byte-signature routing exists. | Adopt truthful text/binary/PDF routing; keep SVG as text. |
| One-based line prefixes | Current output is unnumbered; `offset` is explicitly zero-based. | Adopt one-based labels and preserve zero-based offset compatibility. |
| Repair model inputs | Canonical validation rejects numeric strings and aliases; finite fractional numbers pass because the schema uses `number`. | Adopt read-specific alias/coercion repair and integer validation at `ToolManager`; reject invalid direct calls too. |
| Device/stream blocklist | Workspace containment blocks most external paths, but a workspace rooted at `/` can admit pseudo-devices. | Adopt a pre-I/O blocklist. |
| BOM/CRLF/UTF-8 hygiene | Node's UTF-8 decode is used, but BOM/CRLF normalization and byte-safe output truncation are not explicit. | Adopt and cover at the public seam. |

## Existing strengths to preserve

- Workspace and additional-directory containment use real paths and reject symlink escapes.
- The raw full-file read has a 10 MiB safety cap for internal callers.
- Model output is not shortened by the UI-only `readFileCharLimit` setting.
- Successful reads feed exploration and concurrent-session peer awareness.
- Read-only calls can execute concurrently while writes remain scheduling barriers.

## Regression boundaries

- Do not change the raw `FileActionManager.readFile()` contract used by writes, patches, formatting, notebook edits, and diff capture.
- Do not change `offset` from zero-based to one-based without separate breaking-change approval.
- Keep all stateful behavior disabled by default and independently reversible with the process-local emergency switch.
- Enforce only direct file-mutation tools. Opaque shell, dependency-manager, and Git commands retain their existing permission contracts.
- Never treat a partial, clamped, invalid-UTF-8, unstable-revision, or stale view as complete.
- Do not advertise image attachment until the provider/tool-result path carries typed image blocks end to end.
- Keep path repair read-only and run every candidate through the same containment logic as the original request.

## Stateful-read benchmark

`bun run benchmark:read-state` exercises the real executor and session-persistence path with a deterministic 1,000-line, 75,000-byte file. Each of five alternating-order rounds measures 100 identical reads after one warmup call. The script exits nonzero unless consume-on-hit dedup beats legacy reads on both model-visible bytes and median aggregate elapsed time.

Final local result on 2026-08-11:

| Mode | Model-visible bytes per 100 calls | Median elapsed per 100 calls |
| --- | ---: | ---: |
| Legacy | 8,199,900 | 351.006 ms |
| Stateful dedup | 4,107,450 | 237.913 ms |
| Improvement | 49.909% | 32.220% |

## Validation evidence

| Gate | Evidence |
| --- | --- |
| Focused public-seam tests | `tests/readFileTool.spec.ts`: 35 passing cases, including repaired-path containment, full pseudo-device coverage, complete-response byte accounting, and opt-in digest capture. |
| Stateful system tests | `tests/readStateLedger.spec.ts`: 49 passing cases covering persistence boundaries, state bounds, line/byte/clamp coverage, invalid UTF-8, consume-on-hit recovery, revision changes, all direct mutation targets, stale previews, compatibility flags, and resumed/new/branched sessions. |
| Reproducible performance gate | `bun run benchmark:read-state` passed with 49.909% fewer model-visible bytes and 32.220% lower median aggregate elapsed time. |
| Related tool/action tests | 435 passing Vitest cases across executor, validation, search/replace, filesystem limits, tool scheduling, feature commands, feature flags, peer awareness, and RPC shutdown suites. |
| TypeScript | `bun run typecheck` passed. |
| Lint | `bun run lint` passed. |
| Contract and standards review | Manual compatibility, persistence, bounded-state, malformed-text, preview-staleness, mutation-target, and empty-file monotonicity reviews completed; findings were regression-tested. |
| Full `bun run proof` | Passed on the final aggregate run: lint, typecheck, 554 unit/integration files with 8,114 passing tests, ESM/CJS/type-definition builds, and 5 Tuistory files with 63 passing scenarios. |
