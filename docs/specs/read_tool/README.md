# `read_file` Specification

Status: implemented for the text-read path and three opt-in stateful-read increments.
Reviewed: 2026-08-11.
Source analysis: [source-analysis.md](./source-analysis.md).
Implementation audit: [implementation-audit.md](./implementation-audit.md).

## Purpose

`read_file` must give the model a bounded, truthful, recoverable view of a workspace file. A hostile file shape, an empty result, or a slightly malformed model call must not consume unbounded memory or force the model to guess what happened.

This specification adopts the article's high-value text-read recommendations where they are corroborated or independently testable. It does not copy Command Code's product-specific thresholds or stateful write policy without an Autohand contract.

## Compatibility decisions

- `path` remains Autohand's canonical path field.
- `offset` remains a **zero-based line index** because that is the existing published tool schema. Returned line labels remain one-based so they agree with editors and stack traces.
- `limit` remains optional. `0` and omission select the default window; a positive value selects a smaller window. A caller cannot raise a ceiling by requesting a larger value.
- `ui.readFileCharLimit` continues to affect terminal display only. The bounded model result defined here is independent of that display setting.
- Stateful behavior ships as three ordered, restart-required experiments. All are disabled by default, so existing reads and writes remain compatible:
  - `read_state_ledger` records model-visible coverage without changing tool output or write authorization;
  - `read_state_dedup` implies the ledger and enables consume-on-hit unchanged-read stubs;
  - `read_before_write` implies both earlier increments and enforces the ledger for direct file-mutation tools.
- `AUTOHAND_DISABLE_STATEFUL_READ=1` is the emergency compatibility switch. It disables all three increments for the current process even when their configuration flags are enabled.

## Normative requirements

### RT-1: Input repair and validation

1. The canonical input is `path: string` with optional `offset` and `limit`.
2. When `path` is absent, the model-call boundary may repair an unambiguous string alias such as `file_path`, `filePath`, `absolute_path`, or `absolutePath`.
3. Numeric strings for `offset` and `limit` may be repaired only when `Number(value)` produces a finite, non-negative integer.
4. Fractional, negative, non-finite, partially numeric, and conflicting aliased values must be rejected before filesystem I/O.
5. Direct executor callers that bypass the model-call repair boundary must still receive a validation failure for invalid window values.

### RT-2: Path safety and recovery

1. Every requested or repaired path must pass the existing workspace/additional-directory and realpath containment checks.
2. Device and stream paths that can hang or produce unbounded data must be rejected before opening, including `/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/stdin`, `/dev/fd/*`, and `/proc/<pid-or-self>/fd/*`.
3. A missing filename may be retried using bounded Unicode normalization, narrow-space, and straight/curly-apostrophe variants.
4. Every retry candidate must independently pass containment checks.
5. If no retry succeeds, the failure should include at most three bounded sibling suggestions using normalization-aware substring or edit-distance matching.
6. Recovery must never change a write target; it applies only to the `read_file` path.

### RT-3: Memory-bounded text reading

1. The tool must stream the selected text window instead of loading the entire file before slicing it.
2. Skipped content before `offset`, including a single very large line, must not accumulate in memory.
3. The text path must enforce all three independent ceilings:

   - at most 2,000 returned lines;
   - at most 128 KiB of returned text payload;
   - at most 2,000 Unicode code points from any one line.

4. A smaller positive caller `limit` narrows the line ceiling. A larger value is clamped to 2,000.
5. UTF-8 decoding and byte-budget truncation must not emit a split code point or replacement character solely because a stream chunk or byte ceiling divides a character.
6. A leading UTF-8 BOM is removed, and CRLF is normalized to LF in the model-visible text.
7. The reader must not claim that more content remains until it has observed content beyond the returned window. A file ending exactly at a stream or line boundary is complete.

### RT-4: Output contract

1. Every returned text line is prefixed with its one-based source line number in a stable `cat -n`-style form.
2. An empty file returns an explicit non-error note; it never returns an empty tool result.
3. An offset at or beyond EOF returns an explicit non-error note with the number of lines scanned and advises a smaller offset.
4. A line- or byte-truncated result ends with a non-error continuation note containing the exact zero-based `offset` for the next call.
5. Byte truncation that cuts a displayed source line resumes on that same source line. Line-window truncation resumes on the next source line.
6. A per-line clamp identifies every affected source line and recommends a targeted search or shell inspection rather than silently hiding the clamp.
7. Informational notes do not begin with `Error:`.

### RT-5: Format handling

1. SVG remains on the text path regardless of its `.svg` extension.
2. A file detected as binary from its bytes returns a concise type note instead of decoded garbage.
3. A PDF returns a PDF note with a `pdftotext` recovery hint.
4. Image attachment, coordinate scale disclosure, and structured notebook rendering remain follow-up capabilities. The current string-only `ToolActionOutcome` cannot truthfully claim that an image was attached to the model.

### RT-6: Observability and existing coordination

1. A successful read continues to record exploration and peer-read state once.
2. Repaired reads report the actual workspace-relative path that was opened.
3. Tool output remains full for the model while existing UI-only output compaction may shorten terminal rendering.

### RT-7: Session read ledger

1. When any stateful-read experiment is enabled, every successful text read records what was actually visible to the model, not merely what the scanner loaded.
2. Ledger entries are keyed by the canonical opened path and an observed file revision. A revision contains file size, modification time, change time, and platform file identity where available.
3. The ledger stores no file contents. It stores a raw SHA-256 digest only after a stable, valid-UTF-8 stream has reached EOF, plus merged zero-based ranges for source lines that were shown completely and without a per-line clamp.
4. A line cut by either byte ceiling or the per-line clamp is not covered. A later window may cover a byte-cut line by reading again from that line; a clamped line cannot become covered through `read_file` alone.
5. A text file is complete only when the ledger has a stable raw digest, knows the total source-line count, and merged coverage spans every source line. An empty text file read from offset zero is complete. Binary, document-format, and text views containing replacement for invalid UTF-8 never make an entry complete.
6. Coverage from multiple windows may be merged only while the canonical path still has the same observed revision. Any revision change starts a new entry and discards coverage and dedup records for the older revision.
7. Ledger state is bounded and persists with the active session independently of conversation compaction. Resuming the same session restores it. Starting, forking, or cloning into a different session starts with an empty ledger.
8. Ledger persistence is fail-soft for reads: a storage failure must not turn a successful read into an operational failure. Enforcement remains fail-closed when no trustworthy complete entry is available.
9. `read_state_ledger` alone must not change model-visible read results, mutation outcomes, permissions, previews, undo, RPC, ACP, or teammate behavior.

### RT-8: Unchanged-read deduplication

1. Deduplication is eligible only when `read_state_dedup` or `read_before_write` is enabled and the emergency compatibility switch is not set.
2. A hit requires the same canonical opened path, unchanged observed revision, requested path spelling, zero-based offset, and effective line limit as an earlier model-visible result.
3. A hit returns a short non-error stub identifying the unchanged path and window. The stub must say that repeating the same call will resend the full content.
4. Returning the stub consumes that view record before the call completes. The next identical read returns real content and recreates the record, bounding a stale-reference loop after compaction to one wasted call.
5. A duplicate offset-zero window must not be stubbed while its ledger entry is partial. This preserves the model's escape route when it retries from the beginning to satisfy write safety.
6. A changed revision, repaired path resolving to a different file, failed read, binary note, or ineligible partial offset-zero entry is a cache miss.
7. Dedup state is bounded per file and per session. Eviction causes a full read, never a false hit.
8. Dedup checks the cheap file revision before streaming. The optimization must reduce model-visible bytes and should reduce elapsed time for repeated unchanged complete reads.

### RT-9: Read-before-write enforcement

1. Enforcement is active only when `read_before_write` is enabled and the emergency compatibility switch is not set. Permission bypass, auto-confirm, YOLO, and unrestricted modes do not bypass this content-safety invariant.
2. Creating a path that does not exist does not require a prior read. An operation that would make no byte or path change may return its existing no-op result without a prior read.
3. Before an existing regular file is changed or removed, the ledger must contain a complete entry for its canonical path and the current raw SHA-256 digest must equal the recorded digest.
4. Failures distinguish three recoverable cases: the file has not been read, only part of it has been read, or its bytes changed after the read. Each failure names the path and asks for a complete `read_file` pass before retrying.
5. Enforcement covers every direct file-mutation action according to the bytes or path it can destroy:
   - `write_file`, `append_file`, `apply_patch`, `notebook_edit`, `search_replace`, `format_file`, and `multi_file_edit` guard their existing target;
   - `delete_path` guards an existing regular file; directory deletion retains its existing confirmation and permission contract because `read_file` cannot represent a directory tree;
   - `rename_path` guards its existing source and any existing regular-file destination that would be overwritten;
   - `copy_path` guards an existing regular-file destination that would be overwritten. Its source is not guarded because the operation does not mutate it.
6. Opaque multi-file mutation surfaces such as shell commands, dependency-manager commands, and Git commands retain their existing permission and peer-safety contracts; they are not falsely advertised as ledger-enforced.
7. A successful mutation makes any prior entry stale by changing or removing the on-disk revision. Undo is a user-directed recovery path and is not blocked, but its filesystem change is observed normally by the next dedup or enforcement check.
8. Preview mode performs the same ledger check before proposing a mutation. When a preview is later applied, its captured original state must still match disk; stale previews are rejected instead of overwriting newer bytes.
9. The same `ActionExecutor` boundary is used by interactive, command, RPC, ACP, and mobile runtimes. Headless teammate executors use an isolated in-memory ledger when they have no resumable session store.

### RT-10: Stateful-read experiment controls

1. The feature registry exposes `read_state_ledger`, `read_state_dedup`, and `read_before_write` as disabled-by-default experimental switches with documented config paths.
2. Later increments imply earlier behavior even if only the later switch is configured. This makes illegal combinations resolve to the safest coherent mode.
3. All switches require a restart so the active executor, advertised experiment state, and session persistence boundary cannot drift during a turn.
4. The emergency environment switch wins over local and remote configuration and restores the pre-feature behavior without changing persisted configuration.

## Public test seams

- `ToolManager.execute()` proves model-emitted repair, strict validation, and that invalid calls do not reach the executor.
- `ActionExecutor.executeForTool()` with a real `FileActionManager` proves observable text, recovery-note, format, containment, and streaming behavior.
- No test depends on private scanner functions, stream chunk sizes, or implementation-specific call counts.

## Acceptance matrix

| Scenario | Required observation |
| --- | --- |
| Small UTF-8 text | One-based numbered lines; content preserved |
| Empty file | Explicit `is empty` note |
| Offset past EOF | Explicit smaller-offset guidance and scanned line count |
| Exactly 2,000 lines | Complete result without a false continuation note |
| 2,001 lines | Continuation note with `offset=2000` |
| Multi-byte text at byte ceiling | Valid UTF-8 and a correct resume offset |
| One line over 2,000 code points | Clamped line plus an explicit clamp note |
| Text-like bytes containing invalid UTF-8 | Replacement may be displayed, but the ledger remains incomplete and cannot authorize mutation |
| File larger than the old 10 MiB full-read cap | Requested window succeeds without a full-file allocation |
| CRLF plus BOM | BOM absent and line content normalized |
| Binary bytes in `.txt` | Concise binary note; no raw NUL data |
| SVG XML | Numbered text, not a binary note |
| PDF signature | PDF note with `pdftotext` guidance |
| Blocked pseudo-device | Validation/operational failure before opening |
| Unicode-equivalent filename | Read succeeds and discloses the actual path |
| Near-miss filename | Bounded `Did you mean` suggestions |
| `offset: "2"` through `ToolManager` | Repaired and executed as integer `2` |
| `offset: "2abc"`, `1.5`, or `-1` | Validation failure; executor not called |
| Ledger-only mode, repeated complete read | Both calls return the original full output; session state records complete coverage |
| Resume the same session | Complete coverage and dedup eligibility restore from session state |
| Two identical complete reads with dedup enabled | First returns content; second returns a consume-on-hit stub; third returns content |
| Offset-zero partial read repeated | Real partial content returns again; no dedup loop blocks completion |
| File changes between duplicate reads | Full current content returns; no stale dedup stub |
| Large file read through contiguous windows | Merged complete-line coverage authorizes only after every line is fully visible |
| Existing-file mutation without a read | Recoverable `has not been read` authorization failure |
| Existing-file mutation after partial read | Recoverable `only part` authorization failure |
| Existing-file mutation after disk change | Recoverable `changed after` authorization failure |
| Existing-file mutation after complete unchanged read | Mutation succeeds in enforcement mode |
| New-file creation in enforcement mode | Creation succeeds without a synthetic read |
| Complete empty-file read followed by a beyond-EOF probe | The later probe does not revoke valid authorization for the same revision |
| Stale RPC preview acceptance | Preview application rejects the changed original |
| `AUTOHAND_DISABLE_STATEFUL_READ=1` | Legacy read and mutation behavior is restored for the process |

## Deliberate policy boundary

The Command Code article and its public tool reference still disagree about whether a partial or clamped read may authorize an overwrite. Autohand follows the stricter public contract: only aggregated, completely visible source lines plus a stable full-file digest authorize a mutation. The emergency switch exists for automation that cannot yet satisfy that invariant; partial content is never silently treated as complete.
