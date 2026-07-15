# Test Triage

Adds a focused Bun test tool and a failure-triage agent that can use it.

```sh
autohand extensions validate ./examples/extensions/autohand.test-triage
autohand extensions install ./examples/extensions/autohand.test-triage
```

`run_focused_test` requires the same shell authorization as an equivalent `run_command` call.

```sh
autohand extensions remove autohand.test-triage --yes
```
