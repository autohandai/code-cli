# Build Autohand Code extensions with `$extension-builder`

Autohand Code includes the `$extension-builder` skill. Describe the capability you want, and the agent will choose the smallest compatible extension shape, write the package, validate it, and help you install it.

![A real Tuistory recording of extension-builder creating and installing an extension](../gif/extension-builder-demo.gif)

[Watch the MP4 recording](../video/extension-builder-demo.mp4) or inspect the [asciinema v2 terminal cast](../video/extension-builder-demo.cast).

The recording uses Tuistory to drive the real built Autohand CLI. A deterministic local OpenRouter-compatible fixture supplies the model responses, so the same `write_file`, validation, installation, and discovery paths run without recording an API key.

## Use the built-in skill

Start Autohand in the project you want to extend and mention the skill explicitly:

```text
$extension-builder create a project extension that summarizes workspace status and recent commits, then add a skill that turns that evidence into a concise project brief
```

An exact `$extension-builder` mention activates its instructions in that same turn. The skill will inspect repository guidance, write a failing test or validation fixture, select declarative or trusted-runtime boundaries, build the package, and exercise the extension lifecycle.

## Install the community copy

Autohand already bundles the skill. Install the community copy when you want the same authoring workflow checked into a project or managed through the open Agent Skills ecosystem:

```sh
npx skills add https://github.com/autohandai/community-skills \
  --skill extension-builder -a autohand-code -y
```

Review installed skills before use. The public package includes the Autohand extension v1 contract and the Pi compatibility guide.

## Try the complete demo extension

The recording creates the same package committed at [`examples/extensions/autohand.workspace-brief`](../../examples/extensions/autohand.workspace-brief):

```text
autohand.workspace-brief/
  autohand.extension.json
  README.md
  tools/
    workspace-status.json
    recent-commits.json
  skills/
    workspace-brief/
      SKILL.md
```

Validate it before installation:

```sh
autohand extensions validate ./examples/extensions/autohand.workspace-brief
```

Install it only for the current project while evaluating it:

```sh
autohand --path . extensions install \
  ./examples/extensions/autohand.workspace-brief --scope project
```

Inspect the installed contribution set:

```sh
autohand --path . extensions show autohand.workspace-brief --scope project
autohand --path . extensions doctor
```

Start a fresh Autohand session and invoke the contributed skill:

```text
$workspace-brief summarize the current project state and identify the next concrete action
```

The skill instructs Autohand to gather evidence with `brief_workspace_status` and `brief_recent_commits`. Those tools still pass through Autohand's normal authorization, permission prompts, hooks, and accounting.

## Build your own extension

Give `$extension-builder` observable requirements instead of only a name. Include:

- the evidence or action each tool must provide
- required parameters and safe bounds
- whether the behavior belongs in a reusable skill or focused agent
- project or user installation scope
- any existing Pi or pi-mono source package to adapt

For example:

```text
$extension-builder adapt ./pi-release-helper for Autohand. Preserve its release-range tool and portable Agent Skill, document unsupported Pi UI hooks, validate it, and install it for this project.
```

Pi `SKILL.md` files are portable. Pi TypeScript is treated as untrusted source data and is never executed merely to discover registrations. Faithful bounded tools can become declarative extension tools; commands, events, custom UI, providers, shortcuts, flags, and permission policy can be adapted to a reviewed, compiled runtime entrypoint.

For example:

```text
$extension-builder create a trusted extension with a /deploy command, an Ink deployment menu, a ctrl+k shortcut, and a --deploy-environment flag
```

Runtime extensions must be reviewed and installed with `--trust`. Autohand does not transpile TypeScript or install their dependencies.

## Try the runtime showcase

[`examples/extensions/autohand.runtime-showcase`](../../examples/extensions/autohand.runtime-showcase) demonstrates every trusted v1 registration surface:

```sh
autohand extensions validate ./examples/extensions/autohand.runtime-showcase
autohand extensions install ./examples/extensions/autohand.runtime-showcase --trust
autohand --deploy-environment production
```

Inside Autohand, type `/deploy` or press `ctrl+k` with an empty composer. This is the daily-use surface; `$extension-builder` is only needed when creating or changing the package.

## Manage the result

```sh
autohand extensions list
autohand extensions disable autohand.workspace-brief
autohand extensions enable autohand.workspace-brief
autohand extensions remove autohand.workspace-brief --yes
```

Use linked installation only during development. Before publication, verify a copied installation and start a fresh process to exercise every contributed declarative and runtime surface.

## Re-record the terminal demo

Prerequisites are a built CLI, network access for the public `npx skills` install, and `ffmpeg` on `PATH`:

```sh
bun run build
bun run demo:extension-builder
```

The command drives the shell and Autohand with Tuistory, writes the asciinema v2 cast, and renders the GIF and MP4 embedded above. It uses a disposable workspace and fake credentials; no local provider secret is read or recorded.
