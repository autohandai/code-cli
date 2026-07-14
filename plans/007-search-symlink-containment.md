# Plan 007: Prevent search walkers from following symlinks outside allowed roots

> **Executor instructions**: Follow the plan test-first and run every gate. Stop on a STOP condition. Update `plans/README.md` when complete unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/actions/filesystem.ts tests/security/resourceLimits.spec.ts tests/security/filesystemSearchSymlinks.spec.ts`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

Direct file paths are realpath-checked against the workspace and additional roots, but the in-process semantic and fallback search walkers use `statSync`, which follows symlinks. A symlink inside the workspace can therefore make search read arbitrary outside text; cycles can also cause repeated traversal. Search must reuse the allowed-root trust boundary while still supporting contained symlinks and configured additional directories.

## Baseline state at planned commit

- `src/actions/filesystem.ts:537-593` resolves a direct target through the nearest existing ancestor and checks its real path against workspace plus additional roots.
- `semanticSearch` at lines 440-517 pushes lexical paths, calls `fs.statSync`, follows directory/file symlinks, and reads matching text.
- `walkFallback` at lines 595-639 has the same `statSync` recursion.
- Primary ripgrep search at lines 386-428 does not pass `-L`, so ripgrep does not follow symlinks. The fallback path remains vulnerable and must be forced in tests.
- Existing tests in `tests/security/resourceLimits.spec.ts` cover direct-read symlinks but not search traversal.

### Required traversal behavior

- Inspect entries with `lstat` before following them.
- Resolve symlink targets with `realpath` and admit only targets inside workspace or configured additional roots.
- Keep a visited set of real directory/file paths to prevent cycles and duplicate reads.
- Skip broken or outside symlinks without leaking target contents or throwing the whole search.
- Preserve contained symlinks. Return a stable logical workspace/additional-root-relative display path with no escaping `..` segment.
- Preserve existing hidden/ignored/binary/resource-limit behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| New regression | `bun run test tests/security/filesystemSearchSymlinks.spec.ts` | exit 0 |
| Existing security | `bun run test tests/security/resourceLimits.spec.ts` | exit 0 |
| Search regression | `bun run test tests/searchReplace.spec.ts tests/actionExecutor.spec.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Scope

**In scope**:

- `src/actions/filesystem.ts`
- `tests/security/filesystemSearchSymlinks.spec.ts` (create)
- `tests/security/resourceLimits.spec.ts` only for shared test utilities or direct-path regression.

**Out of scope**:

- Changing ripgrep flags to follow symlinks globally.
- Changing direct read/write containment semantics or allowed-root configuration.
- Replacing search implementation, GitIgnore parsing, result limits, or binary detection.
- New dependencies.

## Git workflow

- Branch: `advisor/007-search-symlink-containment`
- Commit title: `Keep file search inside configured roots`
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Reproduce both walker escapes

Create temp workspace, outside directory with a unique secret sentinel, and workspace symlinks to the outside directory and file. Assert `semanticSearch` never returns the sentinel.

Force `search()` to its fallback walker by mocking `resolveRipgrepCommand` to a nonexistent binary or by a narrow injectable test seam. Assert fallback also omits the sentinel. Do not depend on whether ripgrep is installed on the developer machine.

Add:

- an internal symlink whose target remains under the workspace and is searchable once;
- a symlink cycle that terminates quickly and does not duplicate results;
- a symlink into an explicitly configured additional directory that remains searchable;
- a broken symlink that is skipped;
- result paths with no `..` escape.

On Windows, skip only individual symlink creation cases when the OS returns a known privilege error; do not skip the entire file preemptively.

**Verify**: `bun run test tests/security/filesystemSearchSymlinks.spec.ts` fails on the outside/cycle cases before implementation.

### Step 2: Extract one safe traversal admission helper

Within `FileActionManager`, reuse the existing allowed roots and nearest-ancestor realpath logic. Add a helper that receives a logical path and visited set, calls `lstat`, resolves symlinks, checks real containment, and returns the safe stat/real identity needed by both walkers.

Use `path.relative` segment checks, not string-prefix checks without separators. Normalize case through `realpath` as current root logic does. Treat unknown filesystem errors as a skipped entry.

**Verify**: `bun run typecheck` exits 0.

### Step 3: Apply it to semantic and fallback traversal

Replace raw `statSync` recursion in both walkers. Deduplicate by real path while retaining the first logical display path. Check file size before `readFileSync` using the existing `FILE_LIMITS.MAX_READ_SIZE` policy so a symlink cannot bypass resource protection. Preserve ignore, hidden, binary, result, and window/context behavior.

Do not add `-L` to the ripgrep path. Primary ripgrep and fallback should both remain non-escaping.

**Verify**: `bun run test tests/security/filesystemSearchSymlinks.spec.ts tests/security/resourceLimits.spec.ts` exits 0.

### Step 4: Run search and full gates

**Verify**:

```sh
bun run test tests/searchReplace.spec.ts tests/actionExecutor.spec.ts
bun run test
bun run lint
bun run proof
```

Every command exits 0.

## Test plan

- Outside directory and file symlinks in semantic and forced fallback modes.
- Internal and additional-root symlinks remain searchable.
- Cycle terminates/deduplicates; broken link skips.
- Display paths remain contained and resource limits remain enforced.
- Direct read symlink behavior remains unchanged.

## Done criteria

- [x] Neither in-process walker follows a pre-existing path outside configured roots; the same-user concurrent replacement limit is recorded in `plans/README.md`.
- [x] Cycles terminate with a visited-realpath set.
- [x] Contained/additional-root symlinks still work once.
- [x] Result paths never expose an escaping relative path.
- [x] Existing ignore/binary/size/result limits remain.
- [x] Focused/full tests, lint, and proof pass; index updated.

## STOP conditions

Stop and report if:

- An external sentinel appears in any result.
- A cycle hangs or produces duplicate unbounded traversal.
- Contained/additional-root symlinks regress without a documented product decision.
- The fix changes direct read/write behavior or requires following symlinks in ripgrep.
- Windows tests are broadly skipped instead of narrowly handling privilege errors.
- An out-of-scope file or dependency is needed.

## Maintenance notes

- Future filesystem walkers must use the same realpath admission rule.
- Review result display paths and real-path deduplication separately; both matter.
