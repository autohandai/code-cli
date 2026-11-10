# CLI pull-request integration

This candidate combines the remaining Igor-authored work from [#745](https://github.com/autohandai/code-cli/pull/745), [#743](https://github.com/autohandai/code-cli/pull/743), [#742](https://github.com/autohandai/code-cli/pull/742), [#727](https://github.com/autohandai/code-cli/pull/727), [#690](https://github.com/autohandai/code-cli/pull/690), [#669](https://github.com/autohandai/code-cli/pull/669), and [#747](https://github.com/autohandai/code-cli/pull/747), together with the saved-session input fix from `df44f764`.

The integration starts from main at `150be8938f3bacd4264f0622e88dcffc465bfc8f`. It preserves the intervening explicit Git-initialization change, atomic configuration writes, partial cloud-history protection, extension reload coordination, and permission enforcement. The first validation revision was paused when #747 was added to the requested scope; the expanded revision receives fresh combined checks.

| Area | Resulting behavior | Reference |
| --- | --- | --- |
| Terminal rendering | Full-screen resize clears addressed rows without archiving stale frames in iTerm2; compiled tmux startup uses the real executable. Plain `--tmux` uses the current folder. | [Terminal compatibility](../terminal-compatibility.md) |
| Terminal CI | Real tmux and native iTerm2, Ghostty, cmux, and VS Code scenarios retain resize, streaming, draft, cursor, and exit assertions. iTerm2's Python API stays disabled. | [Compatibility workflow](../../.github/workflows/terminal-compatibility.yml) |
| Squad | Built-in MCP uses the pinned canonical Squad bridge; `/squad` selects an agent and `/message` uses durable delivery. Companion Squad PR #52 is merged. | [Squad ADR](../adr/2026-11-05-built-in-squad-messaging.md) |
| Continuation and sync | Resume the most recently active nonempty conversation in the project. Background sync defaults off; disabling it cancels queued and active work. | [Configuration reference](../config-reference.md) |
| Command output | Cap model observations while preserving complete oversized output in private session artifacts; streamed and nested command paths use the same cap. | [Configuration reference](../config-reference.md) |
| Computer Use | Temporarily enter AUTO for the computer task and restore the preceding mode, preserving subsequent manual selections, explicit denials, hooks, and restricted mode. | [Computer control](../computer-control.md) |
| Saved sessions | Accept composer edits while restoring history and defer submitted work until restoration completes. | [Resume terminal tests](../../tests/tuistory/resume.tuistory.test.ts) |
| CLI contract | Bootstrap the current 199 option definitions across 52 command paths, and compare future changes with the committed main snapshot. | [Option contract](../compatibility/claude-code/README.md) |
| macOS distribution | Check transported CLI and trace binaries for notarization in addition to existing signature checks. | [Release workflow](../../.github/workflows/release.yml) |
| Providers | Keep the active provider when removing an inactive custom entry; preserve it if replacement is cancelled. Cloud restoration clears previous local transport settings. Bound OpenAI-family native tool requests, including delegated agents, and use compatible Azure reasoning parameters. | [Provider reference](../providers.md) |

The provider integration adds regressions for child-agent tool budgets and local-to-cloud account restoration. Azure Responses transport and live Azure tool qualification remain explicitly separate follow-ups; this candidate corrects Chat Completions parameters. Issues #719 and #720 remain open until the corresponding fix is released.

Independent review identified two follow-ups. Newline MCP frames now have a 64 MiB bound with pending-request and listener cleanup. F-0402 now uses the existing names-only skill discovery path by default, keeps normal-sized command observations intact, and uses a compact preview only after output exceeds its configured ceiling. Approved completions hold their candidate while review is pending, then publish one confirmed reply. Explicitly labeled rejected or interrupted drafts retain their existing behavior.

The live `seq 1 400000` command probes reported 15,539 total tokens for Terra and 24,483 for Fantail, each with one command execution and one answer. Each private raw archive retained 2,688,895 bytes and 400,000 lines. These probes used the existing Free account, which correctly cannot invoke paid Moa review. Required-review approval, rejection, cancellation, and delayed-answer behavior have separate deterministic unit and built-terminal coverage; these checks do not establish paid live-provider review qualification.

Validation is recorded against the final candidate before merge. Focused checks, complete proof, native application execution, and live-provider acceptance are separate evidence boundaries. The root execution sandbox denies local loopback listeners with `listen EPERM`, so the combined full proof runs on the hosted GitHub runner. A successful headless terminal test or XCTest compilation does not establish native application success. The candidate must pass the full proof and all four native terminal jobs before merging.

This integration does not publish a release or enable the manually disabled release workflow. Existing primary-checkout working changes are retained separately.
