# Changelog

## Unreleased

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
