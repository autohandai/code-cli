# /autoresearch

`/autoresearch` runs measured code experiments while preserving every candidate,
evaluation, and decision in a replayable append-only ledger. Rejected and
inconclusive candidates are removed from the working tree, but their immutable
artifacts remain available for isolated replay, comparison, and rescoring.

Only candidates accepted by the deterministic policy may advance the Git
lineage. Replay, rescoring, Pareto analysis, and retention never silently create
commits, switch branches, or rewrite historical decisions.

## Start a replayable session

```text
/autoresearch optimize unit test runtime
autohand auto-research optimize unit test runtime
autohand autoresearch optimize unit test runtime
```

New replayable sessions require the workspace to be the root of a clean Git
repository with at least one commit. `init_experiment` captures that commit and
runs a zero-diff baseline before candidate edits are allowed. Initialization
blocks on dirty paths, changed submodules, unsafe scope, a drifting `HEAD`, an
invalid environment allowlist, or an evaluator that does not satisfy the metric
contract.

When enough fields are known, configure the session directly:

```text
/autoresearch optimize test runtime \
  --metric total_ms --unit ms --direction lower \
  --secondary-objective memory_mb:MB:lower \
  --constraint memory_mb:<=:512 \
  --measure "bun run benchmark" --checks "bun run lint" \
  --min-samples 3 --max-samples 9 --confidence 2 \
  --max-iterations 12 --timeout-ms 600000 \
  --max-artifact-bytes 1073741824 --max-artifact-age-days 30 \
  --scope src --scope tests --allow-env CI
```

Start options are additive to the original single-metric contract:

- `--metric`, `--unit`, `--direction`, and `--measure` define the primary
  objective and evaluator.
- Repeated `--secondary-objective name:unit:lower|higher` values participate in
  Pareto ranking but do not decide automatic acceptance.
- Repeated `--constraint metric:<|<=|>|>=:value` values are hard constraints and
  fail closed.
- `--min-samples`, `--max-samples`, and `--confidence` configure adaptive
  sampling. Defaults are 3, 9, and 2.0.
- `--max-artifact-bytes` and `--max-artifact-age-days` configure optional
  retention. Both default to unlimited.
- Repeated `--allow-env NAME` values add non-secret variables to the replay
  fingerprint. Secret-like names are rejected even when explicitly supplied.
- Existing `--checks`, `--timeout-ms`, repeated `--scope`, max-iteration, and
  subagent flags remain supported.

If the benchmark contract is incomplete, the loop instruction asks only for
the fields it cannot infer and calls `init_experiment` before editing candidate
files.

## Metric and decision policy

Every benchmark invocation must emit exactly one finite line for every
configured objective:

```text
METRIC total_ms=42.5
METRIC memory_mb=310
```

The engine starts with three samples, adds one sample at a time when the robust
noise bands overlap, and stops at nine samples by default. It aggregates each
objective with the median and median absolute deviation (MAD). The signed
primary improvement is measured against the latest materialized accepted
evaluation.

- `accepted`: all hard constraints conservatively pass and primary confidence
  is at least the configured threshold.
- `rejected`: a hard constraint conclusively fails or the primary metric
  conclusively regresses.
- `inconclusive`: measurements still overlap at the sample limit.
- `checks_failed` or `crashed`: correctness or evaluator execution failed.

Rejected, inconclusive, checks-failed, and crashed candidates are restored from
the working tree after their records are persisted. Accepted changes remain in
place so the agent can commit them. The exact accepted candidate must be
committed and projected with `log_experiment` before another candidate can run.

## Built-in tools

- `init_experiment` writes the session contract, freezes evaluator artifacts,
  fingerprints the safe environment, and records a sampled zero-diff baseline.
- `run_experiment` captures a full binary Git patch plus untracked regular files
  and symlink targets, samples every objective, persists the evaluation and
  decision, and returns `attemptId`, metric vectors, samples, and the decision.
- `log_experiment` accepts `attemptId` for ledger-backed runs and projects the
  persisted decision into `.auto/log.jsonl`. Model-supplied metric/status fields
  cannot override the engine. The legacy metric/status form remains available
  for pre-ledger sessions.
- `replay_experiment` reconstructs a candidate at its recorded base commit in a
  detached temporary worktree. It defaults to the frozen original evaluator;
  `current` uses the current session evaluator and records drift.
- `analyze_experiments` exposes history, rescoring, comparison, Pareto, pinning,
  and preview-first pruning to the agent runtime.

Existing benchmark, check, and local hook timeouts, tool cancellation, approval
flow, and lifecycle hooks remain in effect.

## Immutable storage

| File | Purpose |
|------|---------|
| `.auto/ledger/events.jsonl` | Versioned append-only candidate, evaluation, decision, pin, and prune records |
| `.auto/ledger/objects/<sha256>` | Deduplicated patches, untracked content, symlink targets, evaluator scripts/config, and raw outputs |
| `.auto/config.json` | Objectives, constraints, sampling, retention, safe environment names, and lineage commits |
| `.auto/measure.sh` | Current evaluator; emits one finite metric per objective |
| `.auto/checks.sh` | Optional correctness checks |
| `.auto/hooks/before.sh` | Optional hook frozen with each candidate and run before benchmark invocations |
| `.auto/hooks/after.sh` | Optional hook frozen with each candidate and run after benchmark invocations |
| `.auto/prompt.md` | Goal, editable scope, tried ideas, wins, and dead ends |
| `.auto/log.jsonl` | Backward-compatible summary projection |
| `.auto/state.json` | Active/paused loop state and iteration counter |
| `.auto/dashboard.html` | Full history, replay drift, materialization, and advisory Pareto dashboard |
| `.auto/finalize.md` | Review-only finalization report |
| `.auto/finalize-branches.json` | Suggested branch commands for committed kept runs |

The ledger loader tolerates a truncated final JSONL append, which can occur on a
process crash. Invalid earlier records and schema-invalid complete records fail
with an actionable line number. Object reads verify their SHA-256 content.

Existing summary-only sessions still load. History labels them non-replayable
because no candidate artifact exists.

## Commands

```text
/autoresearch <goal>                         Start or resume
/autoresearch off                           Pause
/autoresearch status                        Show state, ledger, drift, and Pareto summary
/autoresearch history                       List all attempts and materialization
/autoresearch replay <id> [--evaluator original|current]
/autoresearch rescore <id>|--all             Append decisions using the current policy
/autoresearch compare <a> <b>                Compare samples, aggregates, checks, and decisions
/autoresearch pareto                         List advisory non-dominated candidates
/autoresearch pin <id>                       Protect candidate artifacts
/autoresearch unpin <id>                     Release retention protection
/autoresearch prune [--dry-run]              Preview retention (default)
/autoresearch prune --yes                    Explicitly apply retention
/autoresearch export                         Write the full HTML dashboard
/autoresearch finalize                       Write reviewable finalization artifacts
/autoresearch clear --yes                    Delete the complete session after confirmation
```

Both `autohand auto-research` and `autohand autoresearch` accept the same
subcommands and options.

## Replay and environment safety

Replay creates a detached temporary Git worktree at the candidate's recorded
base commit, applies the stored binary patch and untracked artifacts, runs the
selected evaluator, appends evaluation/decision records, and removes the
worktree even after failure or cancellation. It never changes the user's
branch, index, or working tree.

The original evaluator freezes scripts and configuration; it does not restore
arbitrary environment variables. The fingerprint contains only OS,
architecture, CLI/Node/Bun/Git versions, lockfile and evaluator hashes, and
explicitly allowlisted non-secret values. Complete process environments,
tokens, credentials, cookies, and keys are never persisted.

## Retention

Retention limits are optional. Automatic retention considers only unpinned
rejected or inconclusive candidate objects, oldest first. Metadata and decisions
are permanent. Accepted and pinned artifacts are protected from automatic
retention; deleting protected artifacts requires the explicit `prune --yes`
path. Every applied deletion appends an `artifact_pruned` event so lost
replayability remains visible.

## JSON-RPC

The original lifecycle names and result fields remain compatible:

```text
autohand.autoresearch.start
autohand.autoresearch.status
autohand.autoresearch.stop
```

Additive methods expose the ledger:

```text
autohand.autoresearch.history
autohand.autoresearch.replay
autohand.autoresearch.rescore
autohand.autoresearch.compare
autohand.autoresearch.pareto
autohand.autoresearch.pin
autohand.autoresearch.prune
```

`start` also accepts `secondaryObjectives`, `constraints`, `sampling`,
`retention`, and `environmentAllowlist`. `status` adds optional attempts and
Pareto IDs. Ledger operations emit `autohand.autoresearch.event` notifications
with `started`, `completed`, or `failed` phases while existing
start/status/pause notifications remain unchanged.

ACP continues to advertise `/autoresearch` and routes all subcommands through
the shared command implementation.

## Hooks, dashboard, and finalization

In addition to the existing start, pause, init, before, run, after, log,
complete, and error events, the runtime emits:

- `autoresearch:decision`
- `autoresearch:replay`
- `autoresearch:rescore`
- `autoresearch:prune`

Attempt IDs and decision outcomes are available in hook JSON and as
`HOOK_AUTORESEARCH_ATTEMPT_ID` / `HOOK_AUTORESEARCH_DECISION`.

The dashboard and finalization report show full history, materialization,
replayability, replay drift, and Pareto recommendations. Pareto candidates are
explicitly advisory and are never presented as automatically committed winners.
Finalize still performs no branch operation, reset, deletion, ref update, or
cherry-pick without separate approval.
