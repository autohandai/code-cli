# Built-in CLI option compatibility guard

The guard imports the real Commander program exported by `src/index.ts`. Importing it does not parse arguments or execute a command. The snapshot in `tests/startup/__snapshots__/cli-options.json` currently records 199 built-in option definitions across 52 command paths, including hidden options and commands with no options.

The contract records flag spelling, required/optional/variadic arity, negation, and defaults. `hasDefault` distinguishes an omitted default from an explicit null or false value. User-installed extension flags are outside the built-in snapshot.

Tests compare the current program against both the local snapshot and the snapshot committed on `origin/main`. Changing the golden alongside code cannot silently remove or change an existing option. Jobs running the unit inventory fetch full Git history so the committed comparison is available. The first integration bootstraps this guard because remote main has no snapshot yet.

To record additive options or commands locally:

```sh
git fetch origin main
UPDATE_CLI_OPTIONS_SNAPSHOT=1 bun run test -- tests/startup/cliOptionsSnapshot.test.ts
bun run test -- tests/startup/cliOptionsSnapshot.test.ts
```

The updater rejects removed or changed entries and refuses to write in CI. Existing semantics require an explicit compatibility decision; regenerating the golden alone does not approve them. This guard introduces no Claude Code compatibility flags and no provider or release changes.
