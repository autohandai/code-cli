# Autohand Code Extensions

Autohand Code extensions package reusable tools, focused agents, portable Agent Skills, and explicitly trusted runtime capabilities without changing CLI source. Runtime entrypoints can register slash commands, Ink views, status/help segments, keyboard shortcuts, CLI flags, lifecycle hooks, providers, and permission policy.

To build or adapt one agentically, mention the built-in skill and describe the desired behavior:

```text
$extension-builder build an extension that reviews migrations and install it for this project
```

## Install an extension

Validate an extension before installing it:

```sh
autohand extensions validate ./path/to/extension
```

Install for the current user:

```sh
autohand extensions install ./path/to/extension
```

Install only for the current workspace:

```sh
autohand --path . extensions install ./path/to/extension --scope project
```

Executable runtime packages require an explicit code review and trust decision:

```sh
autohand extensions install ./path/to/runtime-extension --trust
```

Validation never imports runtime code. `--trust` allows declared compiled JavaScript to execute inside the Autohand process; it is not a sandbox or a permission bypass.

Normal installation copies the complete package atomically. Extension development can use an explicit link:

```sh
autohand extensions install ./path/to/extension --link
```

Linked package state is stored under Autohand's extension root; disabling or removing the link never changes or deletes the source directory.

## Inspect and manage extensions

```sh
autohand extensions list
autohand extensions show autohand.code-health
autohand extensions doctor
autohand extensions disable autohand.code-health
autohand extensions enable autohand.code-health
autohand extensions remove autohand.code-health --yes
```

Use `--json` with `list`, `show`, `validate`, or `doctor` for stable, ANSI-free automation output. User-scoped packages live under `$AUTOHAND_HOME/extensions` (normally `~/.autohand/extensions`). Project packages live under `.autohand/extensions`.

The same lifecycle is available inside an interactive session:

```text
/extensions list
/extensions show autohand.code-health
/extensions doctor
/extensions disable autohand.code-health
/extensions enable autohand.code-health
/extensions remove autohand.code-health --yes
```

Mutations refresh declarative and runtime contributions in the active session. A new session discovers the same user/project package snapshot.

Extension-packaged skills are listed by `/skills`, appear in `$` mention suggestions, and can be invoked directly in a prompt. Exact `$skill-name` mentions activate and inject the instructions for that same turn.

Pi Agent Skills use the same `SKILL.md` contract and can be contributed directly. Pi TypeScript extensions require a reviewed `$extension-builder` adaptation to the versioned Autohand runtime API and a compiled JavaScript entrypoint. Autohand never executes Pi TypeScript merely to inspect or validate it.

Installed runtime extensions are used directly through their registered surfaces. For example, `$release-workflow` invokes a contributed skill, while `/deploy production` invokes a contributed slash command. Users do not run `$extension-builder` during daily use.

## Precedence and diagnostics

- Built-in tools, agents, skills, commands, providers, CLI flags, and reserved keybindings cannot be replaced.
- Existing standalone meta-tools and user/external agents remain ahead of extension contributions.
- A project package replaces the same user extension id as one complete package.
- Package ids and contribution names are processed deterministically.
- Invalid, incompatible, unsafe, or conflicting packages contribute nothing and appear in `extensions doctor`.
- Disabled packages remain inspectable but contribute no declarative or runtime capabilities.

## Security model

Installing an extension validates and copies or links files. Declarative packages execute no package code. Runtime packages require `--trust`; trusted entrypoints activate at CLI startup and runtime refresh.

Extension tools use the existing meta-tool shell template contract. On invocation, parameter values are shell escaped and execution passes through the same tool availability checks, immutable security blacklist, permission policy, pre-tool hooks, user approval, lifecycle events, and accounting as built-in command execution.

Trusted runtime code has the same operating-system access as Autohand. Permission contributions govern Autohand-managed actions only. They may add allow/deny policy, but cannot bypass the immutable security blacklist. Review runtime source and bundled dependencies before installing with `--trust`.

Manifests and contributions are size bounded and strict. Absolute paths, traversal, Windows separators in manifest paths, missing files, duplicate JSON keys, invalid UTF-8, unknown manifest fields, and contribution symlinks are rejected. One broken extension cannot stop the CLI from starting.

See [Build Autohand Code extensions with `$extension-builder`](guides/building-autohand-extensions.md) for a recorded start-to-finish workflow. [Extension authoring](extension-authoring.md) documents the complete runtime API and Pi adaptation matrix. Seven packages, including the executable runtime showcase, are available under [`examples/extensions`](../examples/extensions).
