# Runtime Showcase

Demonstrates the executable Extension API v1 surface: `/deploy`, a stateful Ink menu,
status and help segments, `ctrl+k`, a CLI flag, a session hook, a provider, and a
permission policy.

Review the runtime before trusting it, then validate and install it:

```sh
autohand extensions validate ./examples/extensions/autohand.runtime-showcase
autohand extensions install ./examples/extensions/autohand.runtime-showcase --trust
```

Start Autohand with an optional extension flag:

```sh
autohand --deploy-environment production
```

For daily use, enter `/deploy production` or press `ctrl+k` while the composer is
empty. Use the arrow keys and Enter in the custom deployment console; Escape closes
it. The extension also appends `extensions:ready` to the status line and
`ctrl+k deploy` to the help line.

The example provider can be selected with this config:

```json
{
  "provider": "extension:showcase",
  "extensionProviders": {
    "extension:showcase": {
      "model": "showcase-local"
    }
  }
}
```

The permission contribution allows exactly `git status --short` and denies
`npm publish`; Autohand's immutable security blacklist always remains authoritative.

```sh
autohand extensions remove autohand.runtime-showcase --yes
```
