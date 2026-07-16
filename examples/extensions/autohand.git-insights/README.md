# Git Insights

Adds deterministic recent-history and changed-file tools.

```sh
autohand extensions validate ./examples/extensions/autohand.git-insights
autohand extensions install ./examples/extensions/autohand.git-insights
```

Both tools are read-only Git commands but still pass through Autohand's tool availability, hooks, and permission policy.

```sh
autohand extensions remove autohand.git-insights --yes
```
