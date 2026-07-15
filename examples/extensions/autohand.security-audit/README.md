# Security Audit

Adds dependency-audit and suspicious-pattern tools plus a focused security-review agent.

```sh
autohand extensions validate ./examples/extensions/autohand.security-audit
autohand extensions install ./examples/extensions/autohand.security-audit
```

Installation never runs either audit. Invocation still requires normal authorization and cannot override Autohand's immutable security blacklist.

```sh
autohand extensions remove autohand.security-audit --yes
```
