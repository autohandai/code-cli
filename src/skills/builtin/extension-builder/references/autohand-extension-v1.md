# Autohand extension API v1

Use a package directory whose basename equals its qualified extension id.

```text
company.release-helper/
  autohand.extension.json
  README.md
  src/extension.ts
  dist/extension.mjs
  tools/release-range.json
  agents/release-planner.md
  skills/release-workflow/SKILL.md
```

## Manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/autohandai/code-extensions/main/schema/autohand.extension.schema.json",
  "schemaVersion": 1,
  "extensionApi": 1,
  "id": "company.release-helper",
  "name": "Release Helper",
  "version": "1.0.0",
  "description": "Prepare evidence-backed releases.",
  "license": "Apache-2.0",
  "repository": "https://github.com/company/release-helper",
  "contributes": {
    "tools": ["tools/release-range.json"],
    "agents": ["agents/release-planner.md"],
    "skills": ["skills/release-workflow/SKILL.md"],
    "runtime": ["dist/extension.mjs"]
  }
}
```

Keep contribution paths contained, POSIX-style, unique, and regular files. At least one tool, agent, skill, or runtime entrypoint is required. Package ids are qualified lowercase segments and versions use strict `major.minor.patch` form.

## Declarative contributions

Tools use the existing meta-tool JSON contract: lower-snake-case name, description, object JSON Schema parameters, and a shell handler with escaped `{{parameter}}` substitutions. Validation rejects unsafe handlers; invocation still passes through Autohand authorization, hooks, approvals, events, and accounting.

Agents may be JSON or Markdown. Markdown uses its file stem as the agent name and may declare `description`, comma-delimited `tools`, and `model` frontmatter. Agent tool lists grant no permission.

Skills are standard Agent Skill `SKILL.md` files with valid `name` and `description` frontmatter. Enabled extension skills appear in `$` mention suggestions and `/skills`; disabling or removing the extension removes them from the runtime snapshot.

## Trusted runtime contributions

Runtime entries are compiled `.js`, `.mjs`, or `.cjs` files. Validation never imports them; installation requires `--trust`. Trusted code runs inside the Autohand process with the same OS access as Autohand and is not sandboxed.

An entrypoint exports `activate(api)`, a default activation function, or a default object with `activate`. It may return a cleanup function or export `deactivate`.

The versioned `api` exposes:

- `commands.register` for slash commands;
- `ui.React`, `ui.Ink`, `ui.registerView`, `ui.setStatusLine`, and `ui.setHelpLine`;
- `keybindings.register` for non-reserved shortcuts routed through commands;
- `cli.registerFlag` and `cli.getOption`;
- `hooks.on` for Autohand lifecycle events;
- `providers.register` for `extension:<id>` providers;
- `permissions.registerPolicy` for permission overlays that never bypass the immutable blacklist.

Registration is transactional per extension. Reserved or conflicting commands, providers, flags, and keybindings fail activation. One broken runtime is isolated and reported by `extensions doctor`.

## Lifecycle proof

Run validation, linked trusted installation, inspection, doctor, fresh-process discovery, every contributed behavior, disable/enable, copied installation, and disposable removal. Use `--json` for stable automation output. User packages live in `$AUTOHAND_HOME/extensions`; project packages live in `.autohand/extensions`.

```sh
autohand extensions validate ./company.release-helper
autohand extensions install ./company.release-helper --link --trust
autohand extensions show company.release-helper
autohand extensions doctor
```

Use Tuistory for any command, TUI, startup flag, keybinding, menu, modal, or screen transition.
