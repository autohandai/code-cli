# Recovered CLI work

This inventory records the work recovered before reconciling the original checkout with main at `e59017ba7ca72066a051a3f24d5f473c9f9b4ed6`. It distinguishes an exact historical snapshot from work that still needs integration. The snapshot is not a second implementation to merge wholesale.

## Preserved snapshot

The local branch `repair/preserved-local-20261111` points to `68e042b327ee00f1a1dd16834bd2180b48abc0d1`. Its tree preserves all 41 original working files and its parent retains the original local commits. The reconciliation receipt and file hashes are in `.artifacts/reconciliation-20261111/receipt.json`.

The 41 working files principally covered:

- Ink resize and pause/resume behavior, including duplicated frames and scrollback in iTerm2 and tmux.
- Plain `--tmux` startup, `--tmux --zit` argument handling, and launching the correct executable in compiled installations.
- Native terminal drivers and the XCTest terminal lab, tmux drivers, Tuistory resize/startup scenarios, and terminal compatibility CI.
- Startup option documentation and translated configuration references.

During reconciliation, 17 of those files already matched the integrated main version exactly; the other 24 were older or superseded versions. The exact originals remain in the snapshot. They are not 41 outstanding features.

Six original local commits were also preserved and their behavior incorporated into main:

| Original commit | Work |
| --- | --- |
| `df44f764` | Keep composer input available while restoring a saved session. |
| `659ddbaf` | Record Squad management validation and its canonical source revision. |
| `3478d59a` | Align bundled Squad guidance and the source revision. |
| `77264a81` | Bundle Squad member management, group chats, and routines. |
| `ca4f0c54` | Isolate terminal fixtures from the installed Squad bridge. |
| `84411d86` | Integrate Squad agent messaging and built-in MCP. |

See [the integration record](cli-pr-integration-2026-11-10.md) for the combined behavior and the boundaries between focused, aggregate, native-terminal, and live-provider validation.

## Work retained for later integration

The branch cleanup identified five branches containing changes not established as present in main. They were retained rather than discarded as old branch names.

| Branch | Remaining work |
| --- | --- |
| `worktree-voice-dictation` | Voice capture, `/voice`, native helpers, waveform UI, and tests. |
| `fix/capped-plan-label` | Capped-plan parsing, labels, summaries, and upgrade hints. |
| `hosted-dev-entry` | A standalone hosted web entry point with account and browser-opening options. |
| `mcp-dependency-refresh` | MCP SDK migration, protocol negotiation, complete schema preservation, and tool-list refresh. |
| `merge/ci-tuistory-linux-polling` | Immediate and exit-aware terminal test polling that differs from the current settled-frame helper. |

These are preservation findings, not a claim that the branches are ready to merge or pass current aggregate proof. Their independent designs, current requirements, and tests must be reconciled before integration.

Other retained worktrees contain unfinished release, installation, Computer Use trust, or Windows/shell changes, or could not be fully checked on mounted Codync storage. Their HEADs and reasons for retention are recorded in `.artifacts/branch-cleanup-20261111/receipt.json`.

## Recovery evidence

Before removing obsolete worktrees, recovery patches, diagnostic scripts, notes, native test evidence, and private provider captures were preserved under `.artifacts/branch-cleanup-20261111/preserved-worktree-artifacts/`. Copied recovery files were hash-verified. Four artifact directories were moved intact by same-filesystem rename, preserving their directory identities and relative symlinks.

Private captures remain ignored local evidence. They must not be included in commits or public issue reports. The original WIP recovery branch remains local and was not pushed during reconciliation.

The November 12 issue sweep uses a separate per-issue inventory. Resolving an issue does not imply that every retained feature branch has been integrated, and preserving a branch does not establish that its feature is complete.
