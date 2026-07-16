# Autohand extension API v1

Use a package directory whose basename equals its qualified extension id.

```text
company.release-helper/
  autohand.extension.json
  README.md
  tools/
    release-range.json
  agents/
    release-planner.md
  skills/
    release-workflow/
      SKILL.md
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
    "skills": ["skills/release-workflow/SKILL.md"]
  }
}
```

Keep contribution paths contained, POSIX-style, unique, and regular files. At least one tool, agent, or skill is required. Package ids are qualified lowercase segments and versions use strict `major.minor.patch` form.

## Contributions

Tools use the existing meta-tool JSON contract: lower-snake-case name, description, object JSON Schema parameters, and a shell handler with escaped `{{parameter}}` substitutions. Validation rejects unsafe handlers; invocation still passes through Autohand authorization, hooks, approvals, events, and accounting.

Agents may be JSON or Markdown. Markdown uses its file stem as the agent name and may declare `description`, comma-delimited `tools`, and `model` frontmatter. Agent tool lists grant no permission.

Skills are standard Agent Skill `SKILL.md` files with valid `name` and `description` frontmatter. Enabled extension skills appear in `$` mention suggestions and `/skills`; disabling or removing the extension removes them from the runtime snapshot.

## Lifecycle proof

Run validation, linked installation, inspection, doctor, fresh-process discovery, contributed behavior, disable/enable, copied installation, and disposable removal. Use `--json` for stable automation output. User packages live in `$AUTOHAND_HOME/extensions`; project packages live in `.autohand/extensions`.
