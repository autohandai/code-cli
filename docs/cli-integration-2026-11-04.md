# CLI integration review — 4 November 2026

## Scope and preservation

The review starts from local main `75edf47329b6c2fe9672baeaa1094e560e1418d6`. The freshly observed remote main was `79a26efbea50aa0e351c4b5fbdfc6502fef25b8e`; local main was 47 commits ahead and zero behind. Changes are prepared and validated in an isolated checkout. The original uncommitted lifecycle runner, dedup test, and resume-freeze test are excluded from staging and retained byte for byte.

The preceding fixes are already committed locally:

| Commit | Result |
| --- | --- |
| `5d54c326` | Restore settings panel input and isolate unavailable remote sessions during normal sync. |
| `d8fe0b4a` | Keep `/status` and `/sync` visible across Bun renderer handoffs. |
| `f8eaaf63` | Keep all slash-command matches and scroll a five-row window with Up/Down; Tab accepts the selected entry beyond the first five. |
| `75edf473` | Explain empty and oversized Web handoffs with actionable recovery; preserve local conversations. |

The Bun panel regression came from a buffered stdout clear overtaking immediate native console output. Normal output is batched only while the agent renderer owns the screen; explicit Ink synchronized frames retain batching during a pause. Both built Node and source Bun terminal flows were exercised.

## Remote branch inventory

The initial live audit found 23 `cto/*` branches and one `nikita/*` branch. Eighteen CTO tips were already ancestors of local main. Six branches contained unique changes:

| Branch | Reviewed tip | PR | Integration corrections |
| --- | --- | --- | --- |
| `cto/f0390-provider-timeout-20261104` | `6ab77d84` | [734](https://github.com/autohandai/code-cli/pull/734) | Preserve provider defaults; migrate the legacy 30-second value atomically, tolerate read-only files, and retain intervening edits. |
| `cto/f0392-unattended-tool-approval-20261104` | `bdd07b60` | [735](https://github.com/autohandai/code-cli/pull/735) | Share bounded denial state through nested agents, preserve authorization failures, stop later specialists, and return exit 77 with the denied leaf tool. |
| `cto/f0394-reuse-specialist-results-20261104` | `c6f6dfce` | [736](https://github.com/autohandai/code-cli/pull/736) | Clear cached outcomes at every accepted-turn boundary, including skipped preparation; retain partial/failure identity. |
| `cto/f0395-stale-write-guard-20261104` | `ca3b3f9f` | [737](https://github.com/autohandai/code-cli/pull/737) | Reject unstable hashes for fully observed files without imposing unread/partial enforcement by default. |
| `cto/f0396-provider-settings-20261104` | `57444de8` | [738](https://github.com/autohandai/code-cli/pull/738) | Configure every canonical third-party provider, including Sakana; retain account authentication for Autohand AI. |
| `nikita/import-fixes` | `df4560d9` | — | Count folder skills, retain default discovery in place, copy alternate-profile packages without overwriting local packages, and preserve strict global dry-run handling. |

A later GitHub API observation found F0392 at `d9e2d1ee6f1b28757288e8e32be329e41b7e27e8`. Its YOLO-expiry correction was inspected and applied with a regression test in the candidate. Fetching that newer Git object was blocked by DNS in the restricted environment, so ancestry coverage refers to the initial fetched tips; patch coverage of the newer correction is separate.

No remote branches were deleted, no PRs merged, and no package published. The draft PRs retain their maintainer review requirements, including Matt's user-facing copy review. A local integration does not establish remote CI success.

## CI failure diagnosis and cost control

PR735 run `41761822195` failed because an explicit run allowlist still authorized a shell command after the YOLO approval window expired. The terminal had completed the command while the test correctly waited for renewed approval. The fix retains expiry precedence rather than weakening the test or widening timeouts.

PR736 run `41757768663` failed parsing configuration during model selection. Direct truncating configuration writes could expose malformed JSON to another reader. The integrated configuration writer now uses atomic replacement; the model/provider terminal scenarios validate the saved configuration.

Managed branches previously ran the entire CI matrix twice for each update: once for `push` and once for `pull_request`. The candidate excludes `cto/**` and `nikita/**` from push-triggered CI, retains every existing PR check for main/alpha/beta, permits manual dispatch before opening a PR, and cancels superseded runs in the same PR or ref. The matrix and its assertions are retained. These workflow changes take effect only after the workflow is published on the relevant branch.

A later run at `d9e2d1ee` (`41763923061`) passed the scoped-command shard but failed a checkpoint-footer assertion. Tuistory checks a predicate, waits another renderer cycle, and can return a different frame. The checkpoint scenarios now use the existing `waitForTerminalScreen` driver to recheck the actual returned frame within the same deadline. Deterministic regressions require a second read when an approved transient frame settles back to a pending draft; completion assertions remain intact.

## Validation record

Configuration symlinks remain links: writes and migration locks resolve the real target while retaining the configured format. Alternate-profile packages are copied into private staging outside skill discovery and published only after all resources are copied. Publication uses native rename, retains existing destinations, and fails closed on a cross-filesystem move; failure cleanup permits a later retry. Both paths have failure-first regression coverage.

Regression tests were run failing before the corresponding corrections: read-only/intervening-edit timeout migration, expired YOLO authorization, specialist denial propagation and turn reset, unstable file hashing, and alternate-profile folder imports.

Focused results before the final aggregate run:

- Timeout/configuration: 419 passing tests across 15 files; lint and typecheck passed.
- Nested delegation: 159 passing tests across four files.
- Specialist boundaries, YOLO expiry, and workflow configuration: 176 passing tests across six files.
- File revision safety: 69 passing tests across two files.
- Provider settings: 121 passing tests across two files.
- Claude importer before publication hardening: 41 passing tests.
- Final combined configuration, imports, delegation, file-safety, provider, and CI suite: 511 passing tests across 13 files.
- Built terminal approval, scoped-command, and specialist flows: 15 passing scenarios, including direct/nested/parallel/pre-run denied writes, exit 77, request counts, and zero file writes.

These counts overlap and must not be added as a unique-test total. The final publication hardening passed 88 configuration/import tests and two real importer terminal flows. Checkpoint frame handling passed 12 driver tests and seven terminal scenarios. The five-file combined terminal run passed 28 scenarios; these and checkpoint coverage account for 35 distinct targeted scenarios. The final provider-deadline, cloud-streaming, built-CLI smoke, and settings/sync compatibility run passed another 39 scenarios across four files in 168.26 seconds, bringing distinct targeted terminal coverage to 74 scenarios across ten files. This includes the real Bun panel regressions. All model responses in these runs use local fixtures; no live inference, missing cloud-history recovery, account upload, or production deployment is claimed.

The earlier panel/handoff/slash validation reported 40 terminal scenarios passing. Its full proof attempt reported 13,652 passing tests, six failures, and 80 skipped; the six affected files then passed together, 48/48. That focused replay did not turn the earlier aggregate proof green.

## Aggregate proof and environment limits

`CI=true bun run proof` was started with sleep prevention. Lint and typecheck passed, and the unit phase ran until available disk space fell to approximately 442 MiB. The owned proof process was interrupted (exit 130) to avoid exhausting storage. It had reported 23 failures in `PeerMessaging.delivery.test.ts` and two in `goalSubscription.test.ts`; no final aggregate totals or complete error diagnostics were produced. These files subsequently passed separately (27/27 and 9/9). Those replays do not establish a passing aggregate run or explain its failures conclusively. The proof build/terminal phase was not reached. No cache, user data, or remote history was deleted to free space.

The runtime changes were committed before proof began. The later checkpoint scenario/driver-only correction was validated separately with tests, lint, typecheck, and the real terminal scenarios above. Full repository proof remains required before publication.

An earlier normal fetch in the original checkout failed opening `.git/FETCH_HEAD` with `Operation not permitted`. The final normal local fetch and fast-forward succeeded, integrating the candidate through `9cd3f518` into the original checkout. All three pre-existing WIP files retained their exact SHA-256 digests. The candidate commits, documentation, validation logs, and an incremental Git bundle are retained under `.artifacts/remote-branch-review-20261104/` in the original project. Remote Git fetching later also failed DNS resolution; the audit's live GitHub API snapshots and fetched branch tips are recorded separately.

For recovery in a checkout that contains the required base commits, inspect local changes and fast-forward the saved history without resetting them:

```sh
git bundle verify .artifacts/remote-branch-review-20261104/integration-candidate.bundle
git fetch .artifacts/remote-branch-review-20261104/integration-candidate.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
```

Run those commands from the original `cli-3` checkout. The bundle depends on commits already verified present there. If the checkout has moved or any new edits overlap, review the changes before continuing. These commands do not publish to GitHub. Remote CI reductions and corrections are prepared locally and are not active on the remote PRs yet.

## User documentation

See [configuration reference](./config-reference.md) for network defaults, approval exits, specialist reuse, stale-write protection, import behavior, and incomplete-history sync handling. See [Web handoff](./web-handoff.md) for empty/oversized conversation recovery.
