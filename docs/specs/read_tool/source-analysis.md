# Read Tool Source Analysis

Reviewed on 2026-08-11.

Sources used:
- Requested article: <https://commandcode.ai/docs/harness-engineering/read-tool>
- Command Code tool reference: <https://commandcode.ai/docs/reference/tools>
- Command Code repair-layer write-up: <https://commandcode.ai/docs/harness-engineering/tool-call-repairs>
- Apple APFS filename behavior: <https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html>
- MDN `for await...of`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of>
- MDN `parseInt()`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt>
- MDN `Number()`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number>
- Jupyter notebook format: <https://nbformat.readthedocs.io/en/latest/format_description.html>
- SVG 2 spec: <https://www.w3.org/TR/SVG2/>
- Linux device/proc docs: <https://man.archlinux.org/man/zero.4.en>, <https://man7.org/linux/man-pages/man4/random.4.html>, <https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html>
- WHATWG MIME sniffing standard: <https://mimesniff.spec.whatwg.org/>

## Executive Summary

The article mixes three different things: public contract claims, design recommendations, and competitive/operational claims. The public Command Code `Tools` reference independently confirms many core `read_file` behaviors: bounded windows, line numbering, image/notebook special handling, typo recovery, memory-capped streaming, unchanged-read dedup, device-path refusal, and a read ledger checked by write tools.

Several high-value details remain article-only and should be treated as implementation guidance rather than verified public contract: self-expiring dedup records, deferred chunk-boundary truncation, seven filename retry variants, the JPEG quality ladder, the 10,000-character notebook-output cutoff, and the dedup kill-switch environment variable. The biggest audit caveat is a public-doc inconsistency: the article says some clamped/partial reads may still permit overwrite when ledger bytes match disk, while the public `write_file` reference still says partial reads do not count.

## Claim Matrix

| Article claim / recommendation | Status | Evidence and audit note |
| --- | --- | --- |
| `read_file` should have three ceilings: line window, byte cap, per-line clamp. | Verified public contract. | The article recommends all three. The public `Tools` page documents a bounded, line-numbered read with default `limit` 2000 plus a `128 KB` byte cap and `2000-char` per-line clamp, with truncation notes that include resume offsets. |
| Dead ends should return recovery guidance, not silence. | Partly verified. | The article recommends explicit notes for empty files, past-EOF reads, truncation, and PDF handling. The public `Tools` page confirms truncation notes with exact resume `offset`s and PDF extraction hints. I did not find a separate public contract page for the empty-file and EOF-note wording, so those remain article-level guidance. |
| These recovery notes should not be surfaced as `Error:` conditions. | Article-only recommendation. | The article argues that fact-like notes should not be painted as failures in the TUI. I found this explained in the article, but not codified in the public `Tools` reference. Useful audit target for UX behavior. |
| `read_file` should record what the model has seen in a ledger, and write tools should consult it. | Verified public contract. | The article describes a read ledger storing content, mtime, and partial/full state. The public `Tools` page says every read is recorded in the session ledger and `write_file` checks it later. |
| Partial reads and write safety can create cross-tool loops, so read/write/dedup must be designed together. | Design claim, partly corroborated. | The public docs corroborate the existence of the read-before-write invariant. The article’s specific three-way failure mode and production incident are not independently verifiable, but the risk is credible because `write_file` explicitly depends on prior `read_file` state. |
| A clamped read may still be safe to overwrite if the exact recorded bytes match disk. | Conflicts with current public docs. | The article says `write_file` now allows overwrite when recorded bytes equal on-disk bytes even if the view was flagged partial. The public `write_file` docs still say a partial read, including a byte-capped preview, does not count. This discrepancy is the most important public-audit caveat. |
| Unchanged-read dedup should exist. | Verified public contract. | The public `Tools` page says re-reading an unchanged file returns a dedup stub instead of re-sending content. |
| Dedup should be self-expiring on use so stale references cannot loop forever after compaction. | Article-only implementation detail. | The article gives the exact policy: a dedup hit consumes its record. I found no separate public documentation for that behavior, so treat it as a recommended invariant, not a confirmed public contract. |
| Filename repair should happen before hard failure, including normalization and punctuation variants. | Verified at a high level; exact algorithm unverified. | The public `Tools` page says misses retry macOS filename variants and then offer sibling suggestions using substring and edit-distance matching. Apple’s APFS docs confirm filenames preserve normalization while lookup is normalization-insensitive, which makes normalization-aware retries technically grounded. The article’s exact anecdotes, seven retry spellings, and bounded Levenshtein distance are article-only. |
| Each repaired filename candidate must still be rechecked against the workspace boundary. | Article-only but security-significant. | I did not find this exact sentence in the public docs. It is, however, the correct safety posture because repair logic should not bypass path-boundary checks. |
| Large files should be streamed instead of fully loaded into memory. | Verified public contract. | The public `Tools` page explicitly says `read_file` uses memory-capped streaming reads. |
| Truncation at an exact chunk boundary should defer the “more content remains” decision until the next chunk proves it. | Article-only implementation detail, technically plausible. | The article explains the failure mode. MDN confirms that breaking a `for await...of` loop calls the iterator’s `return()` cleanup method, which supports the article’s warning that early loop exit can destroy the stream prematurely. I did not find a public Command Code doc for the deferred-boundary algorithm itself. |
| Images should be attached as actual image inputs, not text dumps. | Verified public contract. | The public `Tools` page says image formats come back as real image blocks the model can see. |
| Image type detection should use content signatures rather than file extensions. | Verified at a high level. | The public `Tools` page says image handling is format-aware, and the article says it sniffs magic bytes rather than trusting extensions. The WHATWG MIME sniffing standard provides the general primary-source rationale: distinguish types from content when processing differs materially. The article’s exact implementation remains unverified. |
| Oversize images should degrade along a JPEG quality ladder rather than fail to attach. | Article-only implementation detail. | The article gives the exact ladder `95 -> 80 -> 60 -> 40 -> 20`. I found no separate public Command Code contract for those thresholds. |
| Downscaled screenshots should disclose the scale factor so click coordinates can be mapped back correctly. | Article-only product behavior, strong recommendation. | I found this only in the article and benchmark table, not in the public `Tools` page. It is a high-value audit check for any vision-driven coordinate workflow. |
| Jupyter notebooks should render as structured documents instead of raw JSON. | Verified at a high level. | The public `Tools` page says notebooks render as tagged cells with outputs. The nbformat spec independently supports the article’s motivation: notebook cells are JSON and multi-line `source` may be stored as lists of strings on disk. |
| Notebook outputs over 10,000 characters should be replaced with pointers/hints rather than inlined. | Article-only implementation detail. | The article gives the exact cutoff and behavior. I found no separate public contract for that threshold. |
| SVG should be treated as text. | Verified public contract. | The public `Tools` page says SVG reads as text. The SVG 2 spec confirms SVG is XML-based text. |
| Binary formats should return a concise type note instead of raw bytes. | Partly verified. | The article states that binary returns MIME-type notes and PDFs get extraction hints. The public docs confirm the PDF hint and format-aware behavior but do not fully spell out the generic binary-file note contract. |
| Line numbering should be 1-indexed and stable across tool/editor/trace references. | Verified public contract. | The public `Tools` page describes `read_file` as line-numbered and states `offset` is a 1-indexed start line. The article’s “match `cat -n`” framing is design rationale. |
| Tool inputs should be repaired instead of immediately rejected when the model drifts slightly. | Verified public contract. | The article recommends alias repair and numeric coercion. The public `Tools` page documents schema-driven repair, alias renaming, and string-number coercion. The separate repair-layer article confirms this is a cross-tool Command Code design principle. |
| Numeric coercion should use `Number()`, not `parseInt()`, and fractional offsets should be rejected. | Partly verified. | The article gives this exact rule. MDN confirms why it matters: `parseInt("1.9")` truncates to `1`, while `Number(value)` returns `NaN` when a string cannot be fully converted. I did not find this exact implementation detail in the public `Tools` page for `read_file`, but it is consistent with the repair-layer write-up. |
| Certain device and stream paths must be refused before any I/O. | Verified public contract. | The public `Tools` page explicitly says device and stream paths such as `/dev/zero`, `/dev/stdin`, and `/proc/<pid>/fd/*` are blocked. Linux manpages independently justify the blocklist: `/dev/zero` yields endless zero bytes, `/dev/urandom` yields arbitrary bytes, and `/proc/<pid>/fd/0` exposes standard input. |
| Read hygiene should normalize BOM/CRLF, avoid splitting UTF-8 code points, and keep a dedup kill-switch. | Article-only implementation detail, technically sound. | I found these specifics only in the article. They are good audit targets, especially UTF-8-safe truncation, but not independently documented by Command Code’s public contract. |

## Meta Claims Outside the Tool Contract

These article claims are not independently verifiable from high-trust public primary sources and should not be treated as implementation requirements:

- “saves billions of tokens a month”
- `~50 million` reads per month
- `98 tests`
- “dozens of modules”
- “a dozen engineers spent over a full release cycle”
- benchmark claims about competitor harnesses, especially Claude Code probing results

This is not just caution on my side; the article itself says the benchmark table and analysis were “produced by AI with little human review” and “should be read that way.” That makes the comparison table useful as a hypothesis source, but weak evidence for requirements.

## Requirements Worth Auditing in Our Implementation

Based on the article plus the corroborating public docs, these are the highest-signal checks:

1. The read path should enforce all three ceilings together: line count, byte budget, and per-line clamp.
2. Every truncation or non-terminal miss should return a model-actionable next step, ideally with a precomputed resume offset.
3. Read-ledger, write safety, and dedup behavior should be tested as one stateful system, not as isolated per-tool units.
4. Dedup logic should be validated against compaction/history eviction so it cannot point the model at vanished context forever.
5. Filename recovery should be normalization-aware and typo-tolerant, but every repaired candidate must still pass workspace-boundary checks.
6. Device/stream pseudo-path refusal should happen before opening the file.
7. Streaming truncation should preserve valid UTF-8 and handle exact chunk-boundary limits without lying about remaining content.
8. Vision/document special cases should stay token-efficient: real image attachments, notebook rendering, SVG-as-text, and concise handling for binary/PDF files.

## Important Public-Doc Caveat

The article and current public `write_file` docs appear inconsistent on partial-read overwrite policy.

- Article claim: a clamped read may still permit overwrite when the ledger’s recorded bytes match disk exactly.
- Public `Tools` docs: partial reads, including byte-capped previews, do not count for overwrite permission.

If we are auditing behavior or aligning our own contract, this needs direct source-code confirmation from Command Code once their implementation is public or from a maintainer statement. Until then, treat the overwrite exception as unverified.

Autohand deliberately follows the stricter public-tools contract: partial, byte-cut, per-line-clamped, and invalid-UTF-8 views do not authorize direct file mutation.
