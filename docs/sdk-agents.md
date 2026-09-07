# Agent discovery over RPC

`autohand.getSupportedAgents` accepts `{}` and returns `{ "agents": [...] }`
for the initialized session's effective agent registry. Each entry contains
`id` (the agent name), `name`, `description`, and `tools`. Optional fields are
`model`, `source`, `extensionId`, `extensionVersion`, and `extensionScope`.
Prompts and local definition paths are excluded.

The list includes built-in, user, external, generated, session (`--agents`),
and enabled extension agents, with the same precedence used by delegation.
After a mutating `/extensions` command, wait for `autohand.turnEnd` before
querying the refreshed registry. The prompt response only acknowledges work.

An uninitialized session returns an RPC error. Older CLI versions without this
method return method-not-found; clients should propagate that error instead of
presenting an empty registry.

Compiled binaries embed the built-in Markdown definitions. Source and packaged
Node builds continue to read adjacent agent files; embedded content supplies
the same definitions when those directories are absent. `bun run build`
regenerates `src/agents/builtinSources.json` from the Markdown sources. When
editing built-ins without a build, run `node scripts/sync-builtin-agent-sources.mjs`.
The registry tests check that file-loaded and embedded definitions match.
