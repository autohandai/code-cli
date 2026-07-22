# Pi and pi-mono compatibility

Pi packages may declare resources in `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions/index.ts"],
    "skills": ["./skills/release-workflow/SKILL.md"]
  }
}
```

Treat Pi source as untrusted data during discovery. Read declared source and dependencies, but never import or execute them merely to inventory registrations. Pi Agent Skills can remain source-compatible; runtime behavior must be deliberately adapted to the Autohand API and compiled to JavaScript.

## Compatibility map

| Pi resource | Autohand target | Rule |
| --- | --- | --- |
| Agent Skill `SKILL.md` | `contributes.skills` | Reuse after validating frontmatter and referenced files. |
| `registerTool` backed by a bounded shell operation | `contributes.tools` | Preserve schema and canonical permission behavior when translation is faithful. |
| Guidance or reusable workflow | Agent Skill | Keep instructions portable and use Autohand tool names. |
| Delegated specialist behavior | `contributes.agents` | Preserve system prompt and restrict the tool list. |
| `registerCommand` | `api.commands.register` | Preserve arguments/results and prove `/` discovery and dispatch. |
| Tool/session/model lifecycle events | `api.hooks.on` | Preserve ordering, cancellation, async behavior, and response semantics. |
| Custom TUI, renderer, editor, widget | `api.ui.registerView` | Use `api.ui.React` and `api.ui.Ink`; prove modal cleanup with Tuistory. |
| Status/help content | `api.ui.setStatusLine` / `setHelpLine` | Use stable segment ids and document replacement behavior. |
| Shortcut or flag | `api.keybindings.register` / `api.cli.registerFlag` | Avoid reserved keys and core option collisions. |
| Provider | `api.providers.register` | Use an `extension:<id>` name and the Autohand `LLMProvider` contract. |
| Permission behavior | `api.permissions.registerPolicy` | Keep the immutable security blacklist authoritative. |
| Arbitrary TypeScript | compiled `contributes.runtime` JavaScript | Bundle dependencies, review the artifact, and install with `--trust`. |

## Adaptation procedure

1. Read `package.json`, every declared `pi.extensions` and `pi.skills` entry, local dependencies, and referenced resources without executing them.
2. Inventory registrations and event handlers by observable behavior.
3. Classify each item as direct, declarative translation, trusted runtime adaptation, native-core-only, or intentionally unsupported.
4. Write failing unit tests and Tuistory coverage before implementing the conversion.
5. Compile TypeScript to `.js`, `.mjs`, or `.cjs`; do not rely on install-time transpilation or dependency installation.
6. Preserve source provenance and an explicit mapping table in the package README.
7. Validate without execution, review the runtime, install with `--trust`, and compare behavior rather than file presence.

Pi runtime extensions and trusted Autohand runtime extensions both execute with user-level process permissions. Compatibility still means reviewed semantic adaptation: do not load Pi TypeScript unchanged or silently drop behavior.
