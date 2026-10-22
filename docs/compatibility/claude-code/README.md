# Claude Code compatibility guard

F-0158.0 establishes the option contract before the compatibility flags are implemented. The test imports the actual Commander program from `src/index.ts`; importing it does not parse arguments or invoke a command action.

The golden at `tests/startup/__snapshots__/cli-options.json` records 189 built-in option definitions across 51 command paths, including 94 root options, hidden flags and commands with no options. It captures flags, required/optional/variadic arity, negation, and defaults. `hasDefault` distinguishes an omitted default from an explicit null or false default. Runtime extension flags depend on the user's installed extensions and are outside this built-in contract.

The tests compare the program with both the working golden and the golden committed on `origin/main`. Updating both code and the golden therefore cannot silently change an existing option. CI fetches history so `origin/main` is available. The first guard PR bootstraps the golden when main does not have one yet.

To record additive flags or commands locally:

```sh
git fetch origin main
UPDATE_CLI_OPTIONS_SNAPSHOT=1 bun run test -- tests/startup/cliOptionsSnapshot.test.ts
bun run test -- tests/startup/cliOptionsSnapshot.test.ts
```

The updater rejects removed or changed entries and refuses to write in CI. A newly added entry must appear in the golden in the same PR. Changes to existing semantics need an explicitly reviewed change to this guard; regenerating the golden alone will not approve them.

`baseline.txt` records the untouched main checks before the candidate's full validation. Each compatibility PR must include its own full-suite diff against that baseline, snapshot diff and real-model headless transcript. The product TRD requires Igor's approval before any merge, with this guard merged before feature branches.
