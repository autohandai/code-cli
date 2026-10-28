# Changelog

## Unreleased

### Added

- Translate supported Claude Code user and project permission rules during import, with a dry-run preview, and remove raw settings and environment data left by earlier imports.

### Fixed

- Keep npm installation successful when optional Computer control setup fails, matching the standalone installers.

- Restore the interactive composer after session export dialogs so typing and a clean exit remain available.

### Changed

- Persistent goals (`/goal`, `/goals` and `--goal`) are enabled by default for 0.9.9. Existing explicit settings are preserved; `/experiments disable slash_goal` turns them off.

### Breaking

`-c` now means `--continue` (as in Claude Code). Use `--auto-commit` for auto-commit.
