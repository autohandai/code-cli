# Autohand Code Extensions Platform

## Status

- **Owner**: Autohand Code CLI
- **Status**: Approved for implementation by the originating request
- **Priority**: P0
- **Target extension API**: `1`
- **Target CLI**: current `main`
- **Public examples repository**: `autohandai/code-extensions` (not publicly available as of 2026-07-15)

## Optimized intent

Recover the extension work from the stale `codex/metatools` worktree, preserve every capability that remains useful, and evolve it into a production-grade extension package contract on the current Autohand Code CLI. Developers must be able to build, validate, install, enable, disable, inspect, and remove declarative extension packages without modifying CLI source. Extension tools and agents must load in the current and future sessions through the existing authorization and agent-runtime paths. The contract must be suitable for a future public `autohandai/code-extensions` repository, include five working example extensions, and be proven through unit, integration, built-CLI, and Tuistory end-to-end coverage.

## Source audit

### Located worktree

- Path: `/Users/igorcosta/Documents/autohand/cli-3-metatools`
- Branch: `codex/metatools`
- Feature commit: `39b6732484077ea486de183f314aa189fe555dbf`
- Worktree state at review: clean
- Drift at review: 20 branch-only historical commits and 265 current-main commits after the merge base

### Recovered capabilities

The feature commit added:

- durable user- and project-scoped shell-backed meta-tools;
- schema validation, handler safety checks, fingerprints, and atomic persistence;
- immediate registration plus reload in later sessions;
- `/tools` management and diagnostics;
- RPC registry inspection;
- external JSON and Markdown agent directories;
- agent delegation using externally loaded definitions;
- unit and integration coverage for the above.

### Current-main assessment

The recovered production files and tests already exist on current `main`. Current `main` also adds session-agent and bare-runtime hardening that the old worktree does not have. Directly merging or rebasing the stale worktree would reintroduce old runtime code and is therefore prohibited.

The missing product layer is a coherent extension package contract and lifecycle:

- no extension manifest;
- no user/project extension registry;
- no install, list, show, enable, disable, remove, or doctor lifecycle;
- no ownership/provenance linking contributed tools and agents to a package;
- no public-repository layout contract;
- no five installable examples;
- no built-CLI end-to-end proof for package installation and runtime loading.

The stale `feature/plugin-system` branch contains no unique commits and is not an implementation source.

## Product principles

1. **Preserve existing contracts.** Meta-tools, external agents, `/tools`, RPC inspection, permission prompts, and built-in tool/agent precedence keep working.
2. **Declarative first.** Extension API v1 loads data, not arbitrary JavaScript. A package cannot run code merely because Autohand starts or scans it.
3. **One execution path.** Extension tools register as meta-tools and execute through the same canonical authorization, hooks, lifecycle events, and shell safety boundary as existing tool calls.
4. **Explicit trust.** Installing an extension is a deliberate action. Discovery never silently installs or executes remote content.
5. **Fail closed, diagnose clearly.** Invalid packages or contributions are excluded from the active runtime and surfaced by `doctor`; they do not partially activate.
6. **Portable package contract.** A package copied from the future `autohandai/code-extensions` repository works without repository-specific code or unpublished dependencies.
7. **Deterministic precedence.** Conflicts are stable, inspectable, and never resolved by filesystem enumeration order.
8. **No startup fragility.** One broken extension cannot prevent the CLI, bare mode, RPC mode, ACP mode, or teammate mode from starting.

## Users and jobs

### Extension developer

- Create a directory with one manifest and contributed tool/agent files.
- Validate it locally without installing it.
- Install or link it into a temporary profile and prove it loads.
- Publish the same directory in `autohandai/code-extensions`.

### CLI user

- Install an extension from a local checkout at user or project scope.
- See exactly which capabilities it contributes.
- Enable, disable, inspect, diagnose, and remove it.
- Understand which package owns a tool or agent.
- Retain all existing meta-tools and external-agent configuration.

### Autohand maintainer

- Evolve the contract by schema/API version rather than guessing package shape.
- Reject incompatible packages with actionable diagnostics.
- Test the public examples against the built CLI before release.

## Scope

### In scope for extension API v1

- A Zod-validated `autohand.extension.json` manifest.
- User scope: `~/.autohand/extensions/<extension-id>/`.
- Project scope: `<workspace>/.autohand/extensions/<extension-id>/`.
- Tool contributions using the existing meta-tool definition contract.
- JSON and Markdown agent contributions using the existing agent definition contract.
- Local-directory install and developer link workflows.
- CLI command: `autohand extensions ...`.
- Interactive command: `/extensions ...` with matching read/manage behavior.
- Registry inspection for RPC clients without changing existing RPC method names.
- Package provenance in tool/agent inspection.
- Atomic installation and state mutation.
- Five repository examples, each independently installable and E2E tested.
- Documentation for authoring, security, compatibility, and publishing.

### Explicitly out of scope for v1

- Executing extension JavaScript, TypeScript, native modules, install scripts, or lifecycle scripts in the CLI process.
- A hosted marketplace, ratings, telemetry, automatic updates, or remote search.
- Installing directly from an unpinned URL or Git branch.
- Letting extensions replace built-in tools, built-in slash commands, permission policy, system security rules, or UI renderers.
- Loading dynamic Ink/React components from disk.
- Changing the existing programmatic status/help-line API.
- Creating or publishing the `autohandai/code-extensions` repository from this checkout.

## Package contract

### Directory layout

```text
code-health/
  autohand.extension.json
  README.md
  tools/
    find-todos.json
  agents/
    code-health-reviewer.md
```

Only paths declared by the manifest are loaded. Undeclared files have no runtime effect.

### Manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/autohandai/code-extensions/main/schema/autohand.extension.schema.json",
  "schemaVersion": 1,
  "extensionApi": 1,
  "id": "autohand.code-health",
  "name": "Code Health",
  "version": "1.0.0",
  "description": "Find maintainability risks and delegate focused code-health reviews.",
  "license": "Apache-2.0",
  "repository": "https://github.com/autohandai/code-extensions",
  "contributes": {
    "tools": ["tools/find-todos.json"],
    "agents": ["agents/code-health-reviewer.md"]
  }
}
```

### Required validation

- `schemaVersion` and `extensionApi` must both equal `1`.
- `id` must use reverse-domain-style lowercase segments: `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$`.
- `name`, `description`, and `version` are required; version is strict `major.minor.patch` semver without executing a package manager.
- Contribution paths are relative POSIX-style paths, unique within their category, and contained by the package root after real-path resolution.
- Absolute paths, `..` traversal, NUL bytes, missing files, directories where files are expected, and symlink escapes are rejected.
- Tool files must satisfy the existing meta-tool schema and handler safety checks.
- Agent files must use the existing JSON or Markdown formats.
- Empty packages and unknown manifest keys are rejected so misspellings cannot silently disable behavior.
- Manifest and contribution files have bounded sizes; oversized input is diagnosed before parsing.

### Identity and ownership

- The install directory name is derived from a filesystem-safe normalized extension id and must agree with the manifest.
- Every loaded contribution retains `extensionId`, extension version, scope, and source path in registry metadata.
- Extension-owned tools use source `extension`; extension-owned agents use source `extension`.
- Removing or disabling a package removes only contributions owned by that package.

## Discovery and precedence

1. Built-in tools and agents retain their current names and cannot be replaced.
2. Existing user/project meta-tools retain their current behavior.
3. User extensions are discovered in stable lexicographic id order.
4. Project extensions are discovered in stable lexicographic id order and may override the same extension id from user scope as one whole package.
5. A contribution name that conflicts with a built-in, standalone meta-tool, standalone user agent, or another active extension is rejected for the conflicting package and reported by `doctor`.
6. Disabled packages are indexed for inspection but contribute nothing to the active runtime.
7. Discovery results must be identical across interactive, command, bare, RPC, ACP, and teammate entrypoints.

No precedence decision may depend on `readdir` order.

## Lifecycle and CLI UX

### Top-level commands

```text
autohand extensions list [--json] [--scope user|project]
autohand extensions show <id> [--json]
autohand extensions validate <path> [--json]
autohand extensions install <path> [--scope user|project] [--link]
autohand extensions enable <id> [--scope user|project]
autohand extensions disable <id> [--scope user|project]
autohand extensions remove <id> [--scope user|project] [--yes]
autohand extensions doctor [--json]
```

Behavior:

- `validate` is read-only and never installs.
- `install` defaults to user scope; project scope requires a workspace.
- Normal installation copies a complete validated package through a staging directory and atomic rename.
- `--link` creates an explicit developer-mode link recorded as such; containment checks still apply to every declared file at every load.
- Reinstalling the identical id/version/content is idempotent.
- Replacing different content requires an explicit replacement flag and remains atomic.
- `remove` prompts on an interactive terminal unless `--yes` is supplied; non-interactive removal without `--yes` fails.
- Human output is concise. JSON output is stable and contains no ANSI sequences.
- Failures set a non-zero exit code and never print a success message.

### Interactive commands

```text
/extensions list
/extensions show <id>
/extensions doctor
/extensions enable <id>
/extensions disable <id>
/extensions remove <id> --yes
```

Interactive commands call the same service as top-level commands. They must not duplicate filesystem or validation logic. Removal inside an active Ink session uses explicit `--yes`; the top-level command owns terminal confirmation prompts.

## Runtime integration

### Tools

- Extension tools normalize into strongly typed meta-tool definitions.
- They register through `ToolsRegistry`/`ToolManager`, not directly with `ActionExecutor`.
- Invocation passes the same availability filter, plan-mode rules, permission manager, immutable blacklist, pre-tool hooks, approval handling, tool lifecycle events, and execution accounting as every other dynamic tool.
- Tool arguments remain shell escaped by the existing template renderer.
- Extension installation never invokes a contributed tool.

### Agents

- Extension agent directories are supplied to `AgentRegistry` as a distinct source.
- Existing built-in, user, external-config, inline session, and bare-mode behavior is preserved.
- Agent tool allowlists are resolved against the final active tool registry; unknown tools do not bypass filtering.
- Loading an agent definition does not execute its prompt or tools.

### Refresh behavior

- Startup discovers extensions once before tool/agent prompt construction.
- Install, enable, disable, or remove refreshes the active registries in the current interactive session.
- Refresh is transactional: either all valid contributions from the new registry snapshot become active or the previous snapshot remains active.
- Dynamic refresh must unregister contributions removed from the snapshot; stale tools and agents cannot survive until restart.

### RPC compatibility

- Existing RPC method names and response fields remain valid.
- Existing tool-registry entries gain optional provenance fields only.
- Extension inspection may add a new method, but old clients must continue working without it.
- No extension lifecycle operation is exposed remotely unless it uses the same validation, authorization, and scope rules as the CLI service.

## State and atomicity

- Package contents live only under the selected extension root or explicit developer link.
- Disabled state is stored separately from the authored manifest so the CLI never mutates publisher content.
- State writes use a temp file plus atomic rename.
- Installation uses a same-filesystem staging directory, validates the staged copy, then renames it into place.
- Interrupted install, disable, enable, or remove operations leave either the old valid state or the new valid state, never a partial active package.
- Registry diagnostics include stable codes, extension id when known, file path, and a human-readable reason.

## Security requirements

- Do not import or evaluate code from an extension directory.
- Do not run `package.json` scripts or dependency installers.
- Do not follow contribution symlinks outside the package root.
- Reject hard-to-audit manifest ambiguity: duplicate keys, unknown keys, invalid encodings, and oversized files.
- Do not allow extension tools to declare approval bypasses.
- Do not allow an extension to alter permission rules, tool availability policy, hooks configuration, provider configuration, or runtime flags.
- All contributed shell commands remain subject to install-time safety validation and invocation-time canonical authorization.
- A package may be inspected and validated without trusting or executing it.
- Diagnostics redact the home directory where normal CLI output already uses `~` and never include environment secrets.

## Compatibility requirements

- No dependency may downgrade Ink below `7.0.0` or React below `19`.
- No new runtime dependency is expected; use existing Zod and filesystem utilities.
- Existing `~/.autohand/tools`, `.autohand/tools`, and `externalAgents` configuration continue to load unchanged.
- Existing `/tools` output remains compatible; additive provenance is allowed.
- Existing status/help line extension APIs remain exported and unchanged.
- Linux, macOS, and Windows path behavior is covered. Manifest paths use `/`; conversion to native paths occurs only after validation.
- Built binaries and the npm package include every schema/runtime file required for extension loading.

## Five required examples

The examples must live under `examples/extensions/` in this repository and be directly portable to the future public repository.

### 1. Code Health

- Id: `autohand.code-health`
- Contributes a TODO/FIXME discovery tool and a maintainability-review agent.
- Proves a package can combine tools and agents.

### 2. Test Triage

- Id: `autohand.test-triage`
- Contributes a focused test command tool and a failure-triage agent.
- Proves required parameters, tool allowlists, and agent-to-extension-tool resolution.

### 3. Git Insights

- Id: `autohand.git-insights`
- Contributes read-only recent-history and changed-file tools.
- Proves multiple tools in one extension and deterministic registration.

### 4. Security Audit

- Id: `autohand.security-audit`
- Contributes dependency-audit and suspicious-pattern tools plus a security-review agent.
- Proves that apparently useful tools still pass invocation-time permission and blacklist checks.

### 5. Release Assistant

- Id: `autohand.release-assistant`
- Contributes release-range and changelog-context tools plus a release-planning agent.
- Proves versioned package metadata and multi-parameter shell templates.

Each example includes a README with purpose, install command, capabilities, expected permission behavior, and an uninstall command.

## Testing strategy

### Test-first requirement

Every production slice begins with a focused failing test. Tests assert behavior and side-effect absence, not only strings.

### Unit coverage

- Manifest parsing, exact schemas, unknown-key rejection, semver, ids, size limits, and diagnostics.
- Path containment on POSIX and Windows-style input, traversal, absolute paths, symlinks, and missing files.
- Precedence, collisions, disabled state, deterministic ordering, and provenance.
- Atomic install/reinstall/replace/remove behavior and interrupted-operation cleanup.
- Tool and agent normalization without executing contributions.

### Integration coverage

- User and project extension discovery in isolated HOME/workspace directories.
- Immediate refresh after install/enable/disable/remove.
- Extension tools registered through the real `ToolManager` authorization path.
- Extension agents loaded through the real `AgentRegistry` and able to reference active extension tools.
- Existing standalone meta-tools and configured external agents continue to load.
- Invalid or conflicting packages are excluded while CLI initialization succeeds.
- RPC tool-registry compatibility and additive provenance.

### Five-example contract suite

A table-driven suite validates, installs, loads, inspects, disables, re-enables, and removes every example. For each example it asserts the exact tool/agent contribution set and package provenance. This suite is the compatibility gate for moving the directory into `autohandai/code-extensions`.

### Built CLI and Tuistory E2E

Use the repository PTY/Tuistory architecture under `src/testing/` and `tests/tuistory/`.

Required built-CLI scenarios:

1. `autohand extensions --help` renders the complete command tree and exits successfully.
2. Validate one good example and one deliberately invalid fixture; exit status and output are truthful.
3. Install each of the five examples into an isolated HOME, list/show it, and prove its contributions load in a fresh process.
4. Disable and enable an installed extension and prove runtime presence changes across fresh processes.
5. Remove an installed extension with explicit confirmation and prove its contributions disappear without affecting another extension.
6. Run `doctor` with malformed, incompatible, conflicting, traversal, and symlink-escape fixtures.
7. Exercise `/extensions list`, `show`, `doctor`, `disable`, and `enable` in a real PTY, including keyboard submission and Ctrl+C/exit stability.

No E2E may read or write the developer's real `~/.autohand` directory.

## Documentation deliverables

- `docs/extensions.md`: user lifecycle and security model.
- `docs/extension-authoring.md`: schema, authoring, validation, compatibility, and publishing.
- README feature/navigation link.
- Config reference for extension paths/state only if configuration is exposed.
- JSON Schema artifact suitable for copying to the future public repository.
- README in each of the five examples.

## Implementation boundaries

Prefer focused modules:

```text
src/extensions/
  schema.ts
  types.ts
  paths.ts
  manifest.ts
  ExtensionRegistry.ts
  ExtensionService.ts
  cli.ts
```

Adjacent integration belongs in:

- `src/core/agent/AgentDependencyComposer.ts` for runtime composition;
- `src/core/agent/dynamicRuntimeExtensions.ts` for snapshot refresh;
- `src/core/toolsRegistry.ts` for typed tool provenance/locations;
- `src/core/agents/AgentRegistry.ts` for extension agent source/path ownership;
- `src/commands/extensions.ts` and slash-command registration for interactive lifecycle;
- `src/index.ts` for the top-level command tree;
- RPC adapter/types only for additive inspection.

Do not broaden `src/core/agent.ts` when an owning focused layer exists.

## Delivery sequence

1. Add failing schema, containment, and registry tests.
2. Implement the read-only manifest/registry layer.
3. Add failing service tests for atomic lifecycle operations.
4. Implement install/validate/list/show/enable/disable/remove/doctor.
5. Add failing runtime integration tests.
6. Wire tool and agent snapshots into the existing dynamic-runtime composition.
7. Add the five examples and their table-driven contract suite.
8. Add top-level and slash commands with built CLI/Tuistory tests.
9. Complete documentation and JSON Schema artifact.
10. Run focused tests, full tests, lint, build/Tuistory proof, package dry-run, and regression audit.

## Release gates

All must pass from the current checkout:

```sh
bun run test
bun run lint
bun run proof
```

Additional required evidence:

- focused extension unit/integration suite;
- five-example compatibility suite;
- built CLI and Tuistory scenarios;
- `bun run typecheck`;
- package dry-run confirms extension runtime/schema/example documentation expected for publication;
- no Ink/React downgrade and no unexpected runtime dependency;
- `git diff --check`;
- final requirement-by-requirement audit against this PRD.

## Done criteria

- [ ] Current `main` retains every recovered meta-tool and external-agent capability.
- [ ] A strict extension API v1 manifest and JSON Schema exist.
- [ ] User and project extension registries load deterministically and fail closed.
- [ ] Validate/install/link/list/show/enable/disable/remove/doctor share one service.
- [ ] Extension tools execute only through the canonical authorized tool path.
- [ ] Extension agents load through `AgentRegistry` with package provenance.
- [ ] Current-session refresh removes stale contributions transactionally.
- [ ] Existing meta-tools, external agents, bare mode, RPC, ACP, teammate, and Ink APIs do not regress.
- [ ] Five portable example extensions exist with READMEs.
- [ ] Every example passes the full lifecycle and fresh-process E2E contract.
- [ ] Built CLI and Tuistory lifecycle scenarios pass.
- [ ] User and author documentation is complete.
- [ ] Tests, lint, proof, package checks, and final regression audit pass.
- [ ] The validated extension slice is committed with the required co-author trailer.

## Stop conditions

Stop and request a product/security decision if implementation would require:

- arbitrary in-process extension code execution;
- bypassing canonical tool authorization or permission prompts;
- changing an existing RPC method or permission decision contract;
- silently replacing a built-in tool, command, or agent;
- reading or mutating the real user profile during tests;
- downgrading Ink or React;
- a destructive migration of existing meta-tools or external agents.
