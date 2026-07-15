# Autohand Code Extensions

Autohand Code extensions are declarative packages that add reusable tools, focused agents, and portable Agent Skills without changing CLI source. Extension API v1 does not import JavaScript or run install/startup scripts.

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

Mutations refresh extension tools and agents in the active session. A new session discovers the same user/project package snapshot.

Extension-packaged skills are listed by `/skills`, appear in `$` mention suggestions, and can be invoked directly in a prompt. Exact `$skill-name` mentions activate and inject the instructions for that same turn.

Pi Agent Skills use the same `SKILL.md` contract and can be contributed directly. Pi TypeScript extensions require a reviewed `$extension-builder` adaptation: Autohand translates faithfully representable tools, skills, and agents, while commands, lifecycle events, custom UI, providers, or arbitrary runtime code remain native source changes with their normal tests and permission boundaries. Autohand never executes Pi TypeScript merely to inspect or install it.

## Precedence and diagnostics

- Built-in tools, agents, and skills cannot be replaced.
- Existing standalone meta-tools and user/external agents remain ahead of extension contributions.
- A project package replaces the same user extension id as one complete package.
- Package ids and contribution names are processed deterministically.
- Invalid, incompatible, unsafe, or conflicting packages contribute nothing and appear in `extensions doctor`.
- Disabled packages remain inspectable but contribute no runtime tools or agents.

## Security model

Installing an extension only validates and copies or links files. It does not run a contributed tool or agent.

Extension tools use the existing meta-tool shell template contract. On invocation, parameter values are shell escaped and execution passes through the same tool availability checks, immutable security blacklist, permission policy, pre-tool hooks, user approval, lifecycle events, and accounting as built-in command execution. An extension cannot request an approval bypass.

Manifests and contributions are size bounded and strict. Absolute paths, traversal, Windows separators in manifest paths, missing files, duplicate JSON keys, invalid UTF-8, unknown manifest fields, and contribution symlinks are rejected. One broken extension cannot stop the CLI from starting.

See [Extension authoring](extension-authoring.md) for the package contract and Pi adaptation matrix. Five complete packages are available under [`examples/extensions`](../examples/extensions).
