# Code Health

Finds TODO/FIXME comments and adds a focused maintainability-review agent.

```sh
autohand extensions validate ./examples/extensions/autohand.code-health
autohand extensions install ./examples/extensions/autohand.code-health
```

The `find_todos` tool runs through the normal shell permission prompt. The extension does not execute anything during install or startup.

```sh
autohand extensions remove autohand.code-health --yes
```
