# F-0158.0 validation

Status: draft. Full regression verification is outstanding. Do not merge.

Base: `origin/main` at `fcd92ec12f30ea113f44ef4887ea0d8c51556331`. The original local main and unrelated worktrees were preserved.

## Main baseline

`baseline.txt` contains the exact two existing hook-context failures. Untouched main completed `bun run test:ci` in 706.39 seconds: 12,194 passed, two failed, 72 skipped. Typecheck and lint passed.

## Focused candidate evidence

- The initial contract test failed because the existing Commander program was not exported; it passed after adding only `export` to that declaration.
- The committed-main regression test failed before its implementation and passed afterward. It verifies that changing both the working golden and an existing option still fails against the committed main contract, and that a missing main ref produces an actionable error.
- All 13 focused tests passed. Removal, spelling, required/optional/variadic arity, negation and undefined/null/false default changes are covered.
- Candidate typecheck, lint and build passed.
- Root help, resume help and MCP-add help matched untouched main byte for byte on stdout and stderr, with exit code zero.
- Snapshot diff: initial golden adds 189 option records across 51 command paths (94 root options). No existing flag definition changed. CI's test job fetches history for the committed-main comparison.

## Real-model headless transcript

Both untouched source main and the built candidate used the existing Autohand account with Fantail in isolated temporary settings. Hooks, MCP and sync were disabled in those temporary settings; stored user settings were preserved. Test credentials are not part of this repository.

```sh
bun dist/index.js -p 'Reply with exactly CC_SNAPSHOT_OK. Do not use tools.' \
  --model fantail --config "$TEST_CONFIG" --path "$TEST_WORKSPACE" \
  --ephemeral --offline --restricted
```

Candidate stdout:

```text
› Reply with exactly CC_SNAPSHOT_OK. Do not use tools.
CC_SNAPSHOT_OK
Completed in 0m 03s · 31.4k tokens used
```

Exit code: 0. The baseline also returned the standalone expected answer and exited 0.

A preliminary baseline attempt with `--bare` was rejected because bare mode requires an explicit API key/helper. It did not reach a model. The account-authenticated transcript above omits `--bare`.

## Aggregate validation boundary

The candidate's final `bun run test:ci` crossed repeated macOS sleep/wake cycles. It lasted 64,056.53 seconds, reported 154 failures and six worker errors, and left some files unexecuted. Individual tests exceeded their configured 30-second deadlines by many minutes. These results are preserved locally and are not a valid zero-new-failures comparison against the uninterrupted 706-second main run.

The required `bun run proof` was invoked after wake. Further sleep cycles again invalidated test timing, and the run was deliberately interrupted. `ioreg` confirmed the Mac lid was closed. No global power settings were changed.

The 13 focused tests and live transcript do not replace aggregate regression proof. A fresh uninterrupted `bun run test:ci` and required proof run remain necessary. Their failure sets must be compared with `baseline.txt` before a merge-ready or zero-new-failures claim.

The TRD requires this guard to merge first and prohibits merging until Igor gives the go. No feature branches are stacked on this unmerged guard. F-0168 continues to wait for F-0113; F-0170 remains design/spike only. No package release is part of this PR.
