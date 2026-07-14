# Plan 008: Fix built-TUI regressions and make Tuistory a release gate

> **Executor instructions**: This is a TUI/startup/release change. Write failing Ink and Tuistory tests first, use the repository's testing architecture, and run every gate. Stop on a STOP condition. Update `plans/README.md` when complete unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/ui/ink/AgentUI.tsx src/ui/ink/InkRenderer.tsx src/ui/ink/SlashCommandDropdown.tsx src/ui/displayUtils.ts src/core/slashCommands.ts tests/ui/ink/AgentUI.test.ts tests/ui/ink/SlashCommandDropdown.test.ts tests/tuistory/built-cli.tuistory.test.ts tests/tuistory/helpers/autohandTuistory.ts package.json vitest.config.ts vitest.tuistory.config.ts .github/workflows/ci.yml .github/workflows/release.yml`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 001-007
- **Category**: tests
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

The authoritative built CLI currently has two reproducible TUI regressions: a 101-line bracketed paste renders its full contents instead of one compact placeholder, and typing the registered multiword `/handoff session` command closes autocomplete. The normal test/proof and release paths do not run the built PTY suite, so these regressions can ship despite thousands of passing unit tests. Fix the real input/suggestion behavior and make the serial built Tuistory suite a mandatory proof, CI, and release gate.

## Baseline state at planned commit

- `tests/tuistory/built-cli.tuistory.test.ts:483-520` sends a real bracketed 101-line paste and requires `[Text Pasted +101 lines]` with no visible final line. This currently fails in the built PTY.
- `src/ui/displayUtils.ts:63-99` correctly converts 5+ lines or 1500+ characters to a compact marker in isolation.
- `src/ui/ink/AgentUI.tsx:378-417` has a pure bracketed-paste consumer, and lines 763-781 store hidden actual text plus the marker. Existing tests call the pure function directly; they do not prove Ink 7's stdin parsing delivers raw markers/content as assumed.
- `src/ui/ink/InkRenderer.tsx:304-336` passes `process.stdin` directly to Ink. Inspect this boundary before choosing where raw paste ownership belongs.
- `tests/tuistory/built-cli.tuistory.test.ts:800-824` types every registered slash command and expects its suggestion to remain visible. `/handoff session` fails.
- `/handoff session` is intentionally one registered command in `src/commands/go.ts` and `src/core/slashCommands.ts`; it is not a `/handoff` parent with subcommands.
- `src/ui/ink/SlashCommandDropdown.tsx:90-99` matches only one slash token, while `buildSubcommandSuggestions` at lines 123-153 requires the first token to be a registered parent with `subcommands`. A registered multiword command fits neither path once the space is typed.
- `package.json:30-34` keeps ordinary test/proof separate from `proof:build-tuistory`.
- CI builds then runs ordinary tests; release runs `test:ci`, which explicitly excludes Tuistory. Neither gates publication on the built PTY suite.
- `vitest.tuistory.config.ts` is the authoritative serial built-test configuration. Preserve its PTY isolation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Paste unit/render | `bun run test tests/ui/ink/AgentUI.test.ts tests/ui/displayUtils.spec.ts` | exit 0 |
| Slash unit/render | `bun run test tests/ui/ink/SlashCommandDropdown.test.ts tests/slashCommandDispatch.spec.ts` | exit 0 |
| Built regression | `bun run proof:build-tuistory` | exit 0, all built PTY scenarios pass |
| Full proof | `bun run proof` | exit 0 and visibly invokes build+Tuistory |
| Lint | `bun run lint` | exit 0 |

## Suggested executor toolkit

- Use `typescript-best-practices`, `vercel-react-best-practices`, and `test-tui` if available.
- Follow Ink 7 and React 19 APIs already used in the repo; do not downgrade versions.
- Use `ink-testing-library` for component/input tests and Tuistory/node-pty for the built terminal proof.

## Scope

**In scope**:

- `src/ui/ink/AgentUI.tsx`
- `src/ui/ink/InkRenderer.tsx` only if the reproduced raw-stream boundary requires it.
- `src/ui/ink/SlashCommandDropdown.tsx`
- `src/ui/displayUtils.ts` only if a line-count edge is proven there; do not change a passing utility to mask stdin loss.
- `tests/ui/ink/AgentUI.test.ts`
- `tests/ui/ink/SlashCommandDropdown.test.ts`
- `tests/tuistory/built-cli.tuistory.test.ts`
- `tests/tuistory/helpers/autohandTuistory.ts` only for reusable deterministic assertions.
- `package.json`
- `vitest.config.ts` and `vitest.tuistory.config.ts` only if gating needs explicit include/exclude clarity.
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Out of scope**:

- Renaming `/handoff session`, inventing a `/handoff` parent, enabling its feature flag by default, or changing RPC/SDK command names.
- Replacing Ink, React, Tuistory, node-pty, or the whole composer.
- Making PTY tests parallel or silently optional.
- Windows binary execution smoke; tracked separately in the post-plan queue.
- Broad workflow/release redesign or dependency upgrades.

## Git workflow

- Branch: `advisor/008-built-tui-release-gate`
- Commit title: `Gate releases on built terminal behavior`
- Body must describe both fixed regressions and where the mandatory gate runs.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Reproduce paste through Ink's actual input path

Keep the existing pure-function tests, but add an `ink-testing-library` test that renders `AgentUI`, writes a complete bracketed paste sequence to the renderer's `stdin`, and inspects the frame. Add a split-chunk variant that divides both start/end markers and content across writes. Assert:

- one compact `[Text Pasted +101 lines]` marker;
- no actual last pasted line in the frame;
- Enter submits the full hidden 101-line text exactly once, not the marker;
- editing/deleting the marker cannot accidentally submit stale hidden content;
- image-paste handling remains one image placeholder.

Run the targeted built Tuistory case as the red end-to-end proof. Do not reduce its line count or change it to a unit-only assertion.

**Verify**: unit render and targeted Tuistory fail on current behavior for the expected reason.

### Step 2: Fix bracketed-paste ownership at the narrowest raw boundary

First observe what Ink 7's `useInput` callback receives for the rendered test; do not assume raw markers survive. Implement one owner for bracketed-paste framing before ordinary text insertion. Acceptable designs include a narrow stdin adapter owned by `InkRenderer` or a component-level raw-input seam, but it must:

- preserve normal key parsing, raw-mode lifecycle, Ctrl+C, arrows, Shift+Enter, mentions, and queue editing;
- buffer partial markers/content without rendering it;
- call the existing `getContentDisplay`/hidden-paste logic once at end;
- remove all listeners/adapters on pause, stop, and unmount;
- avoid a second listener that lets Ink insert the same bytes normally.

Do not add timing heuristics or infer paste from typing speed. Keep bracketed paste protocol-driven.

**Verify**: `bun run test tests/ui/ink/AgentUI.test.ts tests/ui/displayUtils.spec.ts` exits 0, then the existing built large-paste scenario passes.

### Step 3: Reproduce registered multiword matching

Add unit cases to `tests/ui/ink/SlashCommandDropdown.test.ts` and a rendered AgentUI case:

- `/handoff` and `/handoff ` retain `/handoff session` as a candidate;
- `/handoff s` narrows to `/handoff session`;
- exact `/handoff session` remains visible for Tab/Enter acceptance;
- unrelated text after a completed one-word command still uses real `subcommands` only;
- ranking/limits for ordinary commands remain unchanged.

Keep the exhaustive Tuistory loop as the authoritative registry-wide test.

**Verify**: unit test fails on the multiword cases before implementation.

### Step 4: Support registered multiword commands without changing the registry

Extend slash matching with a pure helper that matches the normalized current slash text against full registered command strings containing spaces before falling back to parent-subcommand logic. Preserve the command object and exact command text. Do not synthesize a `/handoff` command or mutate `SLASH_COMMANDS`.

Ensure acceptance replaces the correct input range once and preserves any supported arguments/trailing-space behavior.

**Verify**:

```sh
bun run test tests/ui/ink/SlashCommandDropdown.test.ts tests/slashCommandDispatch.spec.ts tests/core/agent/AgentCommandRuntime.slashParsing.test.ts
```

All pass.

### Step 5: Make Tuistory part of local proof

Restructure package scripts without recursion so `bun run proof` performs, in order:

1. lint;
2. typecheck;
3. ordinary Vitest suite;
4. build;
5. serial Tuistory suite against `dist`.

It is fine to add private scripts such as `proof:unit`; keep `proof:build-tuistory` working for focused use. Running `bun run proof` must visibly execute Tuistory and fail if a built scenario fails.

**Verify**: temporarily select a known failing assertion to prove the command fails, immediately restore it, then run `bun run proof` to exit 0. Do not commit the temporary failure.

### Step 6: Gate CI and release publication

In CI's supported Linux job, run the serial built Tuistory suite after build and ordinary tests. In the release test job, build and run Tuistory before any matrix build/publication dependency can proceed. Do not use `continue-on-error`, blanket skip, or a condition that is false on the release runner.

Keep compiled-binary matrix smoke as-is. Ensure workflow YAML makes the release build depend on the Tuistory-gated test job.

**Verify**: inspect with `rg -n "test:tuistory|proof:build-tuistory" .github/workflows package.json`; output must show mandatory local, CI, and release invocations. Run any repo workflow/YAML validation command if present; otherwise parse/inspect the YAML via existing test tooling without adding a dependency.

### Step 7: Run full built and compatibility gates

**Verify**:

```sh
bun run test
bun run lint
bun run proof
cd /Users/igorcosta/Documents/autohand/agentsdk/tin-wrapper/typescript
bun test src/__tests__/rpc-client.test.ts src/__tests__/sdk-methods.test.ts
bun run typecheck
bun run build
```

Every command exits 0. Confirm Ink remains `^7.0.5` or newer and React remains `^19.2.5` or newer.

## Test plan

- Pure bracket framing: complete/split markers.
- Ink render: real stdin path, compact frame, full exact submit, no duplicate/stale content, image regression.
- Slash helper/render: prefix, space, partial second token, exact multiword, ordinary subcommands/ranking.
- Tuistory: retain 101-line paste and every registered command loop.
- Gate proof: local `proof`, CI, and release all execute built serial Tuistory.

## Done criteria

- [x] Real 101-line paste renders one marker and submits full content once.
- [x] `/handoff session` remains a registered full-command suggestion through exact input.
- [x] No slash command name/feature behavior changed.
- [x] `bun run proof` builds and runs Tuistory.
- [x] CI and release test jobs run Tuistory as mandatory steps.
- [x] All unit, built, lint, proof, and SDK gates pass.
- [x] Ink/React versions are not downgraded; index updated.

## STOP conditions

Stop and report if:

- Either known Tuistory mismatch remains.
- Paste submits the marker, double-inserts content, loses image handling, or needs a timing heuristic.
- The fix requires replacing/downgrading Ink or React.
- The slash registry/wire name changes or a fake parent command is introduced.
- Full proof, CI, or release can be green without actually executing the built PTY suite.
- CI marks product mismatches as skipped/allowed failure.
- An out-of-scope release redesign or dependency is required.

## Maintenance notes

- Any future TUI startup, prompt, menu, screen transition, or keyboard behavior must include built PTY coverage and remain in the release gate.
- Reviewers should verify input ownership/listener cleanup in addition to visual output.
- When CI reports PTY infrastructure failure, fix the runner/harness; do not suppress the product test.
