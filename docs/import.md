# Import Claude Code permissions

From 0.9.9, `autohand import claude --categories settings` translates supported Claude Code allow and deny rules into active Autohand settings. Run the same command with `--dry-run` first to see the mapping without writing files.

User rules come from `~/.claude/settings.json` and merge into your Autohand config. For each repository recorded in Claude Code's project registry or session metadata, plus the current repository, `.claude/settings.json` and `.claude/settings.local.json` merge into that repository's `.autohand/settings.local.json`. Existing settings and rules remain, duplicate rules are not added, and deny rules take precedence over allows.

`Bash(npm test:*)` becomes `run_command:npm test*` and the corresponding `shell` rule. Literal simple shell commands can use these grants. Commands with shell operators, quoting, substitutions, redirection or unsupported execution wrappers need separate approval; when command denies cannot be evaluated safely, those commands stay denied. Read rules map to `read_file`; Edit and Write map to `write_file`. Exact `./path` and `./path/**` patterns (trailing `/**` only) are supported. More complex globs and domain-scoped WebFetch rules are listed as `skipped (no equivalent)` instead of guessed. Exact MCP tool names map to the same tool.

The importer never copies Claude's raw settings or environment block. On your next non-dry-run Claude import, it scrubs any legacy `imported-claude-settings.json` containing raw settings or environment data and reports the cleanup. A dry run only previews that cleanup.
