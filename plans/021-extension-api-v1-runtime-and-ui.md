# Extension API v1 runtime and UI capabilities

Status: COMPLETE

## Objective

Expand Autohand Extension API v1 from declarative agent capability packages into an explicitly trusted runtime extension system. Installed extensions must be able to register slash commands, Ink views, status/help-line segments, keyboard shortcuts, CLI flags, lifecycle hooks, LLM providers, runtime JavaScript compiled from JavaScript or TypeScript sources, and scoped permission policy while preserving deterministic discovery, clean disable/remove behavior, existing tool authorization, and terminal stability.

## Product contract

- Declarative tools, agents, and Agent Skills remain supported without executing package code.
- A runtime extension declares one or more contained JavaScript entrypoints and is never executed unless installation records explicit trust.
- TypeScript authors compile to ESM or CommonJS JavaScript before packaging; Autohand does not install dependencies or transpile source during installation.
- Runtime entrypoints receive a versioned host API and can register commands, views, line segments, keybindings, flags, hooks, providers, and permission policy.
- Extension slash commands appear in `/` completion and execute through the normal command router.
- Custom Ink views run inside the normal modal pause/resume boundary and cannot leave stdin or the alternate screen corrupted when they close or fail.
- Status/help additions use the existing line-segment extension seam and can append, hide, or replace built-in segments.
- Extension keybindings cannot replace reserved safety/navigation bindings and route through registered commands.
- Extension CLI flags are registered before Commander parses argv and reject collisions with core or other extension flags.
- Runtime lifecycle hooks participate in the existing hook response contract and are removed when their extension is disabled or removed.
- Extension providers participate in provider creation, validation, model selection, and config lookup through `extension:<id>` names.
- Extension permission policy can add allow/deny/rule overlays for Autohand-managed actions, but cannot bypass the immutable security blacklist.
- A runtime failure is isolated to the owning extension, reported by diagnostics, and does not prevent healthy extensions or the CLI from starting.

## Trust model

Runtime extensions execute user-trusted JavaScript in the Autohand process and therefore have the same operating-system access as Autohand. Installation requires `--trust` for packages with runtime entrypoints. The trust decision is stored outside the package, survives enable/disable and replacement, and is removed on uninstall. Validation reads and validates runtime files but never imports them.

This is intentionally different from declarative extensions. Permission contributions govern Autohand tool authorization only; they are not a sandbox for arbitrary runtime code. The immutable security blacklist remains authoritative for all actions routed through Autohand.

## Implementation slices

1. [x] Add failing manifest, registry, service, CLI, and diagnostics tests for runtime entrypoints and explicit trust.
2. [x] Add a typed runtime host with per-extension transactional registration and deterministic activation/deactivation.
3. [x] Add failing and passing command tests for runtime slash-command discovery, dispatch, and live refresh.
4. [x] Add Ink component and Tuistory coverage for custom views, status/help lines, and keybindings.
5. [x] Register extension CLI flags before argv parsing and cover collision/error behavior.
6. [x] Connect runtime hooks to `HookManager` and extension permission overlays to `PermissionManager`.
7. [x] Connect `extension:<id>` providers to config normalization, provider creation, and model lookup.
8. [x] Update schema artifacts, CLI inspection output, examples, `$extension-builder` references, and authoring documentation.
9. [x] Run targeted suites, lint, typecheck, build, full `bun run proof`, regression audit, and the required commit.

## Compatibility and stop conditions

- Do not downgrade Ink 7, React 19, Bun, Vitest, or tsup.
- Do not weaken the immutable security blacklist or existing permission prompt semantics.
- Do not execute runtime code during `extensions validate` or while copying/linking an untrusted package.
- Do not silently claim TypeScript source execution; require compiled JavaScript artifacts.
- Do not let an extension replace built-in commands, flags, providers, tools, agents, or skills.
- Stop and redesign if custom Ink rendering cannot preserve raw-mode, alternate-screen, Ctrl+C, and composer resume behavior under Tuistory.

## Required proof

```sh
bun run test -- tests/extensions tests/providers tests/permissions tests/ui
bun run test:tuistory -- tests/tuistory/extensions.tuistory.test.ts
bun run lint
bun run proof
git diff --check
```

The final proof must demonstrate a real installed trusted extension that contributes a slash command, a custom Ink view, status/help content, a keyboard shortcut, a CLI flag, a lifecycle hook, a provider fixture, and a permission overlay, then disables or removes those contributions without restarting into a broken terminal.
