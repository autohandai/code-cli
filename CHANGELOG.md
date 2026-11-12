# Changelog

## Unreleased

## 0.9.11 - 2026-11-12

### Added

- Configure delegated-agent request limits with `agent.subagentMaxIterations`; exhausted work returns partial findings and an explicit completion status.
- Answer ACP follow-up questions through capability-gated form elicitation, with cancellation and session-retirement cleanup.
- Choose Keenable in `/search`, onboarding or settings with your own API key. Search results use the selected provider, and keys remain masked in the terminal.
- Squad MCP now also manages agent profiles, abilities, extra project folders, skills, group chats, channel membership and scheduled routines.
- Squad is built in as an MCP connection. Select an agent in the running app with `/squad`, send it direct messages with `/message`, and read conversation history and delivery receipts. The connection also reads Squad artifacts and memories.

### Fixed

- Retain answer-only runtime commit identities when repository refs are packed, including worktree common-directory refs.
- Continue required completion review with disclosed session evidence when a large workspace diff exceeds its capture time budget.
- Apply supported anchored and numbered single-file patches, reject ambiguous or no-op changes, and authorize rewritten targets before editing.
- Preserve per-agent model, reasoning and explicit research-only scope; forward Code Mode image evidence once while retaining compact script-visible hints.
- Use compatible OpenAI endpoints, token limits, reasoning and sampling parameters; preserve configured reasoning on custom endpoints and bound token-parameter recovery to one resend.
- Keep malformed historical tool calls as readable context and enforce OpenRouter deadlines through complete response body reads.
- Use authoritative running llama.cpp context capacity without blocking composer startup or overriding explicit user limits.
- Send the Autohand identity and opaque per-conversation routing on official OpenCode Go endpoints, and avoid whole-turn replay after Managed Identity authentication failure.
- Stop automatic replay after storage-capacity failures, report unsaved-state risk, and recover valid project-history rows without rewriting original logs.
- Resolve built-in skills from encoded filesystem paths and preserve complete project associations for new Cursor imports containing spaces, percent signs or Unicode.
- Enforce bare all-tool denials for advertised and fabricated tools and automatic specialist preparation; ACP reports whether deny-all scope was activated.
- OpenAI-compatible fine-tuned and proxy models can recover once when their API requires a different completion-token parameter.
- Start chat and file work in ordinary folders without initializing Git or creating an ignore file. Existing repositories still show their branch; initialize Git only when you choose to use it.
- Keep the composer editable while restoring saved conversations, preserve drafts and early submissions, and wait for restored history before executing queued work.
- Prevent full-screen resize frames from accumulating in iTerm2 scrollback, preserve drafts and cursor edits, and relaunch compiled executables correctly inside tmux. Plain `--tmux` uses the current folder; `--worktree` and `--zit` request isolation explicitly.
- Restore the previous interaction mode after a Computer Use task while preserving manual mode changes, explicit permission denials, hooks, and restricted mode. MCP startup waits for the child process and decodes fragmented UTF-8 responses correctly.
- Continue the latest nonempty conversation in the current project, and keep background sync disabled until explicitly enabled. Disabling sync cancels queued and active work immediately.
- Bound command output sent to the model while retaining complete oversized output in private session artifacts. Configure the limit with `tools.maxCommandOutputChars` or `AUTOHAND_MAX_COMMAND_OUTPUT_CHARS`.
- Discover installed skills through a compact name index and load descriptions on demand. Keep approved completions to one confirmed reply instead of displaying the candidate before its required review.
- Require notarization checks for transported macOS CLI and trace binaries, and protect the existing CLI option contract with a committed snapshot.
- Preserve the active provider and model when removing another custom provider, and clear remembered local transport settings when restoring the cloud account.
- Bound OpenAI-family tool requests to 128 definitions, including delegated agents, and use compatible completion parameters for Azure reasoning models.

### Testing

- Exercise resize behavior through real tmux and native iTerm2, Ghostty, cmux, and VS Code windows in GitHub Actions, with the iTerm2 Python API disabled.

See [the 0.9.11 release notes](docs/changelog/whats-new-0.9.11.md) for details.

## 0.9.10 - 2026-11-04

### Added

- Opt-in adaptive skills load complete pinned instructions for the current task, display loading receipts, and retain skill references in paused goals. Registry discovery and local authoring remain available. Local learning and decision models have separate controls and remain off by default.
- Translate supported Claude Code permission rules during import, offer a dry-run preview, and discover default-profile skills in place with their resources.
- Unattended turns exit with status 77 at the first missing tool approval, including nested agents and specialist dispatch.

### Fixed

- Restore resumed-session input readiness and connect MCP in the background without resetting saved history. Paint the composer before background startup work finishes.
- Reduce resize flicker, preserve drafts and cursor placement, restore the composer after dialogs, and keep `/status` and `/sync` panels visible.
- Browse the complete slash-command menu with Up/Down. Steer queued input with Ctrl+S where Ctrl+Enter cannot be distinguished.
- Preserve newer settings and credentials when startup authentication finishes late. Serialize atomic configuration writes and preserve symlinked profiles.
- Reject stale observed-file edits, safely migrate legacy provider timeouts, and keep account quota handling scoped to first-party inference.
- Retain incomplete remote session history during sync and give actionable web-handoff errors without losing local conversations.
- Keep npm installation successful when optional Computer Use setup fails. Authenticate alpha release discovery when a GitHub token is available and retain API errors.

### Changed

- Reuse specialist pre-run results within a turn and keep programmatic tool contracts stable during long tasks.
- Describe `--bare` startup behavior explicitly in command help.
- Offer a useful folder orientation prompt after installation.

See [the 0.9.10 release notes](docs/changelog/whats-new-0.9.10.md) for details.

## 0.9.9

### Changed

- Persistent goals (`/goal`, `/goals` and `--goal`) are enabled by default. Existing explicit settings are preserved; `/experiments disable slash_goal` turns them off.

### Breaking

- `-c` means `--continue`. Use `--auto-commit` for auto-commit.
