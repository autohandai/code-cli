# Authoring Autohand Code Extensions

Extension API v1 supports two package layers:

- declarative tools, agents, and Agent Skills, which are validated as data and do not require code trust;
- trusted runtime entrypoints, which can register slash commands, Ink UI, status/help content, keybindings, CLI flags, lifecycle hooks, providers, and permission policy.

Start an agentic authoring session by invoking the built-in skill and describing the observable result:

```text
$extension-builder create a project extension with a /deploy command, a deployment menu, and a ctrl+k shortcut
```

For daily use, an extension's skill is invoked with `$name`, while a registered command is invoked with `/name`. The extension-builder skill is for authoring; users do not invoke it to run an installed extension.

## Package layout

```text
company.release-helper/
  autohand.extension.json
  README.md
  src/
    extension.ts
  dist/
    extension.mjs
  tools/
    release-range.json
  agents/
    release-planner.md
  skills/
    release-workflow/
      SKILL.md
```

Only files declared in `autohand.extension.json` contribute capabilities. Runtime packages may include source and bundled dependencies, but `contributes.runtime` must point to compiled `.js`, `.mjs`, or `.cjs` files. Autohand does not transpile TypeScript or install dependencies during installation.

## Manifest

```json
{
  "$schema": "https://raw.githubusercontent.com/autohandai/code-extensions/main/schema/autohand.extension.schema.json",
  "schemaVersion": 1,
  "extensionApi": 1,
  "id": "company.release-helper",
  "name": "Release Helper",
  "version": "1.0.0",
  "description": "Prepare and inspect releases.",
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

The machine-readable contract is [`schema/autohand.extension.schema.json`](../schema/autohand.extension.schema.json).

Requirements:

- `schemaVersion` and `extensionApi` are exactly `1`.
- `id` uses qualified lowercase segments such as `company.extension-name`.
- `version` uses strict `major.minor.patch` semver.
- Contribution paths use `/`, remain inside the package, and resolve to regular non-symlink files.
- A package contributes at least one tool, agent, skill, or runtime entrypoint.
- Unknown manifest keys, duplicate paths, conflicting names, traversal, invalid UTF-8, and missing files are rejected.

## Trust and execution model

Validation never imports runtime code. Installation of a package containing `contributes.runtime` requires explicit trust:

```sh
autohand extensions validate ./company.release-helper
autohand extensions install ./company.release-helper --trust
```

`--trust` is a code-execution decision, not a permission shortcut. A trusted runtime executes inside the Autohand process with the same operating-system access as Autohand. It is not sandboxed. Review the runtime and its bundled dependencies before trusting it.

Trust is stored in Autohand state outside the package, survives disable/enable, and disappears on removal. Disable and removal deactivate every registration from that extension. A failing activation contributes nothing, appears in `extensions doctor`, and does not prevent healthy extensions or the CLI from starting.

## Runtime entrypoint

Export `activate(api)`, a default activation function, or a default object with `activate`. Activation may return a cleanup function. An optional exported `deactivate` function is also called when Autohand reloads, disables, or removes the extension.

```js
export async function activate(api) {
  // Register capabilities here.
  return async () => {
    // Release resources owned by the extension.
  };
}
```

The API is versioned as `api.version === 1`. TypeScript authors can import its public type and compile their source before packaging:

```ts
import type { ExtensionRuntimeAPI } from 'autohand-cli';

export function activate(api: ExtensionRuntimeAPI): void {
  // Registrations are type checked in source and emitted as JavaScript.
}
```

All registrations from one extension are transactional. A duplicate, malformed, reserved, or conflicting registration rejects that extension's activation rather than leaving partial runtime state.

## Slash commands and daily use

Register qualified behavior behind a normal slash command:

```js
api.commands.register({
  command: '/deploy',
  description: 'Open the deployment workflow',
  execute(context) {
    const environment = context.args[0]
      || context.cli.getOption('deployEnvironment')
      || 'staging';
    return `Preparing ${environment} from ${context.workspaceRoot}`;
  },
});
```

After installation, a user runs it directly inside Autohand:

```text
/deploy production
```

Runtime commands appear in `/` suggestions and use the normal Autohand command router. They cannot replace built-in commands. A command may return text, nothing, or a registered view request.

## Ink views, menus, dialogs, renderers, and editor UI

`api.ui.React` and `api.ui.Ink` are the exact React 19 and Ink 7 instances used by Autohand. Use them instead of bundling another React or Ink copy.

```js
const { React, Ink } = api.ui;

function DeployMenu({ close, environment }) {
  const [selected, setSelected] = React.useState(0);
  const choices = ['Plan', 'Validate', 'Cancel'];

  Ink.useInput((_input, key) => {
    if (key.upArrow) setSelected((value) => (value + 2) % 3);
    if (key.downArrow) setSelected((value) => (value + 1) % 3);
    if (key.return) close(`${choices[selected]} selected for ${environment}`);
  });

  return React.createElement(
    Ink.Box,
    { flexDirection: 'column' },
    ...choices.map((choice, index) => React.createElement(
      Ink.Text,
      { key: choice, color: selected === index ? 'cyan' : undefined },
      `${selected === index ? '❯' : ' '} ${choice}`,
    )),
  );
}

api.ui.registerView({
  id: 'company.release-helper.deploy',
  title: 'Deployment console',
  component: DeployMenu,
});

api.commands.register({
  command: '/deploy',
  description: 'Open the deployment workflow',
  execute(context) {
    return context.ui.open('company.release-helper.deploy', {
      environment: context.args[0] || 'staging',
    });
  },
});
```

Every view receives `close(value?)`, `workspaceRoot`, and the command `args`, plus the properties supplied to `context.ui.open`. Autohand owns modal pause/resume, alternate-screen cleanup, Escape, and Ctrl+C behavior. Components may build menus, dialogs, custom renderers, or editor-like interfaces with normal Ink composition.

## Status and help lines

Append, hide, or replace line segments through the existing line-extension contract:

```js
api.ui.setStatusLine({
  segments: [{ id: 'release-state', text: 'release:ready', color: 'success' }],
});

api.ui.setHelpLine({
  segments: [{ id: 'release-shortcut', text: 'ctrl+k deploy', color: 'accent' }],
});
```

A line contribution accepts `segments`, `separator`, `hiddenDefaultSegmentIds`, and `replaceDefault`. Segment colors are `text`, `muted`, `accent`, `success`, `warning`, `error`, or `dim`. Use stable, extension-specific segment ids.

## Keyboard shortcuts

Shortcuts route through a command already registered by the same or an earlier extension:

```js
api.keybindings.register({
  key: 'ctrl+k',
  command: '/deploy',
  when: 'input-empty'
});
```

`when` is `input-empty` by default or `always`. Modifier combinations support `ctrl`, `meta`/`alt`, and `shift` with letters, digits, arrows, Tab, Space, and F1-F12. Autohand reserves safety and composer controls including Ctrl+C, Ctrl+D, Escape, Enter, and Shift+Tab. Conflicting or reserved shortcuts reject activation.

## CLI flags

Flags are registered before Commander parses startup arguments:

```js
api.cli.registerFlag({
  flags: '--deploy-environment <name>',
  description: 'Default deployment environment',
  defaultValue: 'staging',
});
```

Read the camel-cased value with `context.cli.getOption('deployEnvironment')` or `api.cli.getOption('deployEnvironment')`. Every extension option must contain a long `--kebab-case` name and cannot collide with a core or extension option.

## Lifecycle, session, tool, and model hooks

Runtime hooks use the existing Autohand hook events and response contract:

```js
api.hooks.on('session-start', (context) => ({
  additionalContext: `Release Helper is active in ${context.workspace}`,
}));

api.hooks.on('pre-tool', (context) => {
  if (context.tool === 'run_command' && context.command === 'npm publish') {
    return { continue: false, message: 'Use /deploy instead.' };
  }
});
```

Supported events are the events documented in [Hooks](hooks.md), including session, prompt, response, tool, file, permission, notification, sub-agent, auto-mode, and auto-research lifecycle events. Handlers may be synchronous or asynchronous. They run deterministically with configured hooks, can add context, and can stop an operation through the normal hook response.

## Providers

Provider ids use the `extension:` namespace:

```js
api.providers.register({
  name: 'extension:company-release',
  displayName: 'Company Release Model',
  create(config, rootConfig) {
    let model = config.model;
    return {
      getName: () => 'extension:company-release',
      complete: async (request) => callCompanyModel(request, config, rootConfig),
      listModels: async () => ['release-model'],
      isAvailable: async () => true,
      setModel: (value) => { model = value; },
      getModel: () => model,
    };
  },
});
```

Configure and select it with:

```json
{
  "provider": "extension:company-release",
  "extensionProviders": {
    "extension:company-release": {
      "model": "release-model",
      "apiKey": "...",
      "baseUrl": "https://models.example.com"
    }
  }
}
```

The provider factory receives the named extension config and the complete root config. Provider implementations must satisfy Autohand's `LLMProvider` contract and should keep secrets in user config or environment variables, never in the extension package.

## Permission-policy contributions

Trusted extensions can contribute normal permission settings:

```js
api.permissions.registerPolicy({
  allowList: ['run_command:git status --short'],
  denyList: ['run_command:npm publish'],
  rules: [
    { tool: 'run_command', pattern: 'git diff *', action: 'allow' }
  ]
});
```

Policies can contribute allow/deny lists, rules, tool patterns, and path/URL decisions. They cannot replace the session permission mode or decision cache. They affect actions routed through Autohand; they do not sandbox arbitrary extension code. Pattern and path/URL contributions use the normal pattern phase immediately after the immutable blacklist. Exact extension deny-list entries run before the session cache and permission mode; exact extension allow-list entries run after the mode and therefore do not bypass restricted mode. Autohand's immutable security blacklist is always checked first and cannot be overridden by an extension, unrestricted mode, or user configuration.

## Declarative tool, agent, and skill contributions

Declarative tools continue to use the meta-tool JSON contract. Parameters are JSON Schema objects, `{{parameter}}` substitutions are required and shell escaped, unsafe handlers are rejected, and every invocation passes through canonical authorization.

Agents may be JSON or Markdown and use `description`, `systemPrompt`, `tools`, and optional `model`. An agent tool list never grants permission.

Skills are portable Agent Skill `SKILL.md` files. Enabled skills appear in `$` suggestions and `/skills`; an exact mention such as `$release-workflow` activates the instructions for that turn.

## Pi and pi-mono adaptation

Pi Agent Skills remain directly portable through `contributes.skills`. Pi runtime source must still be reviewed as untrusted input and adapted to the Autohand runtime API; Autohand never imports Pi code merely to inspect it.

Typical mappings are now direct:

- `registerCommand` to `api.commands.register`;
- Pi UI/renderers/editors to `api.ui.registerView` using the host React and Ink instances;
- events to `api.hooks.on`;
- shortcuts and flags to `api.keybindings.register` and `api.cli.registerFlag`;
- providers to `api.providers.register`;
- permission behavior to declarative tools plus `api.permissions.registerPolicy`.

Compile converted TypeScript to a declared JavaScript runtime file, document intentional semantic differences, validate without execution, review the output, and install with `--trust`.

## Validate, test, and publish

```sh
autohand extensions validate ./company.release-helper
autohand extensions install ./company.release-helper --link --trust
autohand extensions show company.release-helper
autohand extensions doctor
autohand --deploy-environment production
autohand extensions disable company.release-helper
autohand extensions enable company.release-helper
autohand extensions remove company.release-helper --yes
```

Before publishing, verify a copied install as well as a development link, start a fresh CLI, exercise every command, view, line contribution, shortcut, flag, hook, provider, policy, tool, agent, and skill, then prove disable/enable/removal. TUI behavior requires a real PTY/Tuistory test in addition to component tests.

See [`examples/extensions/autohand.runtime-showcase`](../examples/extensions/autohand.runtime-showcase) for a complete executable package. Extension API v1 installs local directories; use immutable release tags when distributing a checkout and do not ask users to trust code they have not reviewed.
