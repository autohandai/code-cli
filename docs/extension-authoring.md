# Authoring Autohand Code Extensions

Extension API v1 packages tools, agents, and Agent Skills as data. It deliberately excludes arbitrary JavaScript, TypeScript, native modules, dependency installation, lifecycle scripts, dynamic Ink components, and permission-policy changes.

Start an agentic authoring session by mentioning the built-in skill and describing the outcome:

```text
$extension-builder create a project extension that gathers release evidence and teaches the agent our release workflow
```

## Package layout

```text
autohand.code-health/
  autohand.extension.json
  README.md
  tools/
    find-todos.json
  agents/
    code-health-reviewer.md
  skills/
    code-health/
      SKILL.md
```

Only contribution files declared in `autohand.extension.json` have runtime behavior.

## Manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/autohandai/code-extensions/main/schema/autohand.extension.schema.json",
  "schemaVersion": 1,
  "extensionApi": 1,
  "id": "autohand.code-health",
  "name": "Code Health",
  "version": "1.0.0",
  "description": "Find maintainability risks.",
  "license": "Apache-2.0",
  "repository": "https://github.com/autohandai/code-extensions",
  "contributes": {
    "tools": ["tools/find-todos.json"],
    "agents": ["agents/code-health-reviewer.md"],
    "skills": ["skills/code-health/SKILL.md"]
  }
}
```

The runtime JSON Schema is available at [`schema/autohand.extension.schema.json`](../schema/autohand.extension.schema.json).

Requirements:

- `schemaVersion` and `extensionApi` are exactly `1`.
- `id` uses lowercase qualified segments such as `company.extension-name`.
- `version` is strict `major.minor.patch` semver.
- Contribution paths use `/`, remain within the package, and point to regular files.
- Unknown keys and empty packages are rejected.
- A package cannot reuse a built-in, standalone, or already-active contribution name.

## Tool contribution

Tools reuse the durable meta-tool contract:

```json
{
  "name": "find_todos",
  "description": "Find TODO comments under a tracked path",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Repository-relative path" }
    },
    "required": ["path"]
  },
  "handler": "git grep -n TODO -- {{path}}",
  "source": "user"
}
```

Names use lower snake case. Parameters must be a JSON Schema object. Every `{{parameter}}` value is required at execution and shell escaped. Dangerous handler patterns are rejected at validation, and every invocation still uses canonical authorization. Do not embed credentials or assume approval.

## Agent contribution

JSON agents use the existing agent fields: `description`, `systemPrompt`, `tools`, and optional `model`.

Markdown agents use the file name as the agent name and may declare frontmatter:

```markdown
---
description: Review maintainability risks
tools: read_file, fff_grep, find_todos
---
Review the requested code and return evidence-backed findings.
```

An agent tool list does not grant access. Names are resolved against the active filtered tool registry, and normal permission checks remain in force.

## Skill contribution

Skills use the portable Agent Skills `SKILL.md` contract:

```markdown
---
name: code-health
description: Review maintainability risks with the extension tools.
---

Use `find_todos` to gather evidence before recommending changes.
```

Enabled extension skills appear in `$` mention suggestions and `/skills`. An exact mention such as `$code-health` activates and injects the skill instructions into that same turn. Disabling or removing the owning extension removes its skills from subsequent runtime snapshots. Skill names cannot shadow built-in, user, project, or other extension skills.

## Pi and pi-mono adaptation

Pi packages can declare both TypeScript extensions and Agent Skills under the `pi` key in `package.json`. Their valid `SKILL.md` files can be reused directly under `contributes.skills`; this is the shared portable path.

Pi TypeScript extensions are not executed by Autohand extension API v1. Use `$extension-builder` to inspect the package without importing it, inventory `registerTool`, `registerCommand`, event, UI, provider, and persistence behavior, then adapt each capability:

- translate faithful bounded shell operations into declarative tools;
- translate reusable guidance into skills and focused delegation into agents;
- implement commands, events, UI, providers, and arbitrary runtime behavior in the owning Autohand source layer with tests when the user authorized Autohand self-modification;
- document any intentionally changed or unsupported semantics instead of claiming partial compatibility.

This preserves Autohand's install-time no-code-execution guarantee while making Pi Agent Skills directly portable and giving Pi extensions a reviewed semantic conversion path.

## Validate and test

```sh
autohand extensions validate ./autohand.code-health
autohand extensions install ./autohand.code-health --link
autohand extensions show autohand.code-health
autohand extensions doctor
autohand extensions remove autohand.code-health --yes
```

Before publishing, test copied installation as well as developer linking, start a fresh CLI process, exercise every tool, agent, and skill with expected permission prompts, and verify disable/enable/removal. The repository compatibility suite performs this lifecycle for every directory under `examples/extensions`.

## Publishing contract

The future `autohandai/code-extensions` repository can copy the schema and example directories without rewriting manifests. Keep each package independently installable, include a README with validation/install/removal commands and permission behavior, and use immutable release tags when distributing a checkout. Extension API v1 intentionally does not install directly from an unpinned remote URL.
