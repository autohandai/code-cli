# `read_file` Implementation Audit

Audit date: 2026-08-10.
Baseline: local `main` at `deceaeff`.
Normative contract: [README.md](./README.md).

## Baseline path

At the audited baseline, the model-visible tool schema was registered in `src/core/toolManager.ts`, calls were converted to `AgentAction` and executed by `src/core/actionExecutor.ts`, and the executor loaded text through `FileActionManager.readFile()` before applying line and size heuristics in memory.

## Implemented path

- `ToolManager` repairs only unambiguous read aliases and fully numeric non-negative integer strings before schema validation.
- `ActionExecutor` independently validates direct callers, preserves the zero-based offset contract, and formats one-based source labels plus actionable recovery notes.
- `FileActionManager.readFileWindow()` reuses the existing containment boundary, blocks pseudo-device paths before I/O, performs bounded read-only filename recovery, sniffs binary signatures, and delegates text to the streaming scanner in `src/actions/readFile.ts`.
- The scanner skips pre-offset content without accumulation and enforces the line, complete-response byte, and per-line ceilings without splitting UTF-8 code points.
- The legacy `readFile()` contract remains unchanged for mutation and compatibility callers.

## Finding-by-finding disposition

| Finding | Baseline evidence | Decision |
| --- | --- | --- |
| Three independent ceilings | The executor has a 2,000-line threshold and 80 KiB threshold, but no per-line clamp. Explicit `limit` can bypass the line threshold. | Adopt all three as hard output ceilings. |
| Recovery instead of silence | Empty files return an empty string. Past-EOF windows also return an empty string. Large-file output includes a continuation example. | Adopt explicit empty/EOF/truncation notes. |
| Read-before-write ledger | No model-view ledger exists. Peer awareness records only mtime for concurrent-session warnings. | Defer; cross-tool and potentially breaking. |
| Self-expiring unchanged-read dedup | No unchanged-read result cache exists. | Defer with the ledger design. |
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
- Do not add write denial based on read history in this slice.
- Do not advertise image attachment until the provider/tool-result path carries typed image blocks end to end.
- Keep path repair read-only and run every candidate through the same containment logic as the original request.

## Validation evidence

| Gate | Evidence |
| --- | --- |
| Focused public-seam tests | `tests/readFileTool.spec.ts`: 34 passing cases, including repaired-path containment, full pseudo-device coverage, and complete-response byte accounting. |
| Related tool/action tests | 455 passing tests split across the public read/tool/filesystem/peer slice and the legacy executor suite. |
| TypeScript | `bun run typecheck` passed. |
| Lint | `bun run lint` passed. |
| Two-axis review | Standards and specification reviews completed; all high/medium findings were resolved and regression-tested. |
| Full `bun run proof` | Passed on the final aggregate run: lint, typecheck, 553 unit/integration files with 8,062 passing tests, ESM/CJS/type-definition builds, and 5 Tuistory files with 63 passing scenarios. An earlier unrelated extension PTY no-data timeout passed unchanged on its exact rerun before the clean aggregate. |
