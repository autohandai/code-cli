# `read_file` Specification

Status: proposed for the text-read path.
Reviewed: 2026-08-10.
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
- Stateful unchanged-read deduplication and a read-before-write ledger are not added by this change. They alter write authorization and conversation state and require a separate cross-tool design review.

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

## Deferred cross-tool work

The article's read ledger and consume-on-hit dedup cache are credible ideas, but they are not isolated read-tool changes. Before adopting them, Autohand needs a separate specification covering:

- which write/edit tools require a prior full read;
- how partial and per-line-clamped views are represented;
- what content or file identity proves a safe overwrite;
- how compaction invalidates dedup references;
- how the ledger interacts with peer-awareness, preview mode, undo, RPC, and resumed sessions;
- compatibility and escape-hatch behavior for automation.

The Command Code article and public tool reference currently disagree about whether a partial/clamped read can authorize an overwrite, so that behavior is explicitly not used as an Autohand requirement.
