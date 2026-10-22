# Changelog

## Unreleased

### Fixed

- The curl and PowerShell installers skip Computer control on releases that do not support it. Optional Computer control setup failures warn and leave the CLI ready to use.

### Breaking

`-c` now means `--continue` (as in Claude Code). Use `--auto-commit` for auto-commit.
