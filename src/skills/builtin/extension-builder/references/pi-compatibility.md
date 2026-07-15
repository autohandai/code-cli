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

They may also use conventional `extensions/` and `skills/` directories. Pi TypeScript extensions commonly export a default factory and register tools, commands, events, UI, flags, shortcuts, providers, or renderers. Detect both legacy pi-mono package imports and the installed Pi distribution's current package names; do not rewrite imports until the target contract is confirmed from the source.

## Compatibility map

| Pi resource | Autohand target | Rule |
| --- | --- | --- |
| Agent Skill `SKILL.md` | `contributes.skills` | Reuse directly after validating frontmatter and referenced files. |
| `registerTool` backed by a bounded shell operation | `contributes.tools` | Preserve schema and permission behavior; translate only when semantics are faithful. |
| Guidance or reusable workflow | Agent Skill | Keep instructions agent-portable and use Autohand tool names. |
| Delegated specialist behavior | `contributes.agents` | Preserve system prompt and restrict the tool list. |
| `registerCommand` | Autohand command source | Add and register a slash command with unit and Tuistory coverage. |
| Tool/session/model lifecycle events | Hook or owning runtime source | Preserve ordering, cancellation, and failure semantics with focused tests. |
| Custom TUI, renderer, editor, widget, shortcut, or flag | Ink/UI or startup source | Implement natively and prove the real terminal flow with Tuistory. |
| Provider registration or arbitrary runtime code | Provider/runtime source | Do not smuggle executable code into extension API v1. |

## Adaptation procedure

1. Read `package.json`, every declared `pi.extensions` and `pi.skills` entry, local dependencies, and referenced resources without executing them.
2. Inventory registrations and event handlers by observable behavior.
3. Classify each item as direct, declarative translation, native Autohand implementation, or unsupported.
4. Build the Autohand package and any authorized source changes test-first.
5. Preserve source provenance and an explicit mapping table in the output package README.
6. Validate both the reused skills and the resulting Autohand extension. Compare behavior, not just file presence.

Pi extensions execute arbitrary TypeScript with full user permissions. Autohand extension API v1 intentionally does not. Compatibility means a reviewed semantic adaptation with no silently lost capability, not loading Pi TypeScript unchanged.
