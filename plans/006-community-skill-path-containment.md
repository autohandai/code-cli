# Plan 006: Contain community-skill identifiers and files to trusted roots

> **Executor instructions**: Execute this plan test-first. Run every verification. Stop and report on any STOP condition. Update `plans/README.md` when complete unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/types.ts src/skills/types.ts src/skills/GitHubRegistryFetcher.ts src/skills/CommunitySkillsCache.ts src/skills/SkillsRegistry.ts src/skills/communityInstaller.ts src/commands/skills-install.ts tests/skills/GitHubRegistryFetcher.spec.ts tests/skills/CommunitySkillsCache.spec.ts tests/skills/SkillsRegistry.community.spec.ts tests/skills/communityInstaller.test.ts tests/commands/skills-install.spec.ts tests/commands/skills-install-fallback.spec.ts`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

Community catalog IDs, names, directories, and file-map keys cross a network-to-filesystem boundary. Registry validation is incomplete, cache methods join and even remove paths built from untrusted IDs, and installation writes map keys below a directory built from an untrusted name. A malicious registry or poisoned legacy cache can escape cache/install roots, overwrite unrelated files, or remove an outside directory during force install.

## Baseline state at planned commit

- `src/skills/GitHubRegistryFetcher.ts:210-256` checks required field types and `SKILL.md` presence but does not fully constrain `id`, `name`, or `directory`.
- `normalizeRegistryFilePath` at lines 365-371 rejects `.`/`..` segments after trimming slashes, but does not reject backslashes, drives/UNC, NUL, URL query/fragment injection, and raw map keys are retained after fetch.
- `src/skills/CommunitySkillsCache.ts:99-163` joins `skillId` into body/directory paths. `setSkillDirectory` removes that derived directory before validating every map key.
- `src/skills/SkillsRegistry.ts:151-237` joins `pkg.name`/`skillName` and each relative map key. Force mode may remove the derived skill directory first.
- `src/skills/types.ts:118-132` already defines the canonical install-name rule: 1-64 lowercase alphanumeric/hyphen characters. Reuse it; do not add a second slug regex.
- `src/commands/skills-install.ts:469-517` has partial metadata/target/file validation, but the shared tool/noninteractive installer and cache do not share one sink-safe rule.
- Valid skills may contain nested assets such as `templates/example.md` and `scripts/check.ts`; containment must preserve them.

### Required path policy

- Filesystem directory IDs/names must pass `isValidSkillName`; display metadata may remain distinct only if the existing type/flow already distinguishes it.
- Registry source directories and file entries are non-empty relative POSIX paths. Reject NUL, backslash, absolute/drive/UNC paths, `.`/`..`, empty segments, query/fragment injection, and control characters.
- Do not sanitize unsafe values into another name. Reject them to avoid collisions.
- Resolve every destination beneath an explicit root with `path.resolve` and `path.relative`.
- Validate all metadata and all files before any read/write/remove, hook, scanner, parser, activation, or telemetry side effect.
- Revalidate cached content on every read; network-time validation alone is insufficient.
- Reject destination roots/ancestors that are symlinks escaping the intended cache/install root.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Registry/cache | `bun run test tests/skills/GitHubRegistryFetcher.spec.ts tests/skills/CommunitySkillsCache.spec.ts` | exit 0 |
| Registry/import | `bun run test tests/skills/SkillsRegistry.community.spec.ts tests/skills/communityInstaller.test.ts` | exit 0 |
| Commands | `bun run test tests/commands/skills-install.spec.ts tests/commands/skills-install-fallback.spec.ts` | exit 0 |
| Tool surface | `bun run test tests/tools/install-agent-skill.test.ts tests/core/agent.skillTools.spec.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Scope

**In scope**:

- `src/types.ts` only if the `GitHubCommunitySkill` type needs safe distinction.
- `src/skills/types.ts`
- `src/skills/GitHubRegistryFetcher.ts`
- `src/skills/CommunitySkillsCache.ts`
- `src/skills/SkillsRegistry.ts`
- `src/skills/communityInstaller.ts`
- `src/commands/skills-install.ts`
- New focused `src/skills/communitySkillPaths.ts` for shared pure validation/containment.
- Tests listed in the command table, including new `tests/skills/CommunitySkillsCache.spec.ts`.

**Out of scope**:

- Changing catalog URLs, skill frontmatter format, activation names, scope selection, hooks, telemetry schemas, or SDK/RPC methods.
- Renaming valid catalog entries or rewriting unsafe names.
- Replacing the security scanner or adding archive support.
- Deleting legacy cache globally; unsafe entries should become invalid/cache misses with a clear error.
- New dependencies.

## Git workflow

- Branch: `advisor/006-community-skill-path-containment`
- Commit title: `Contain community skill files within trusted roots`
- Body must mention poisoned-cache and force-removal coverage.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Add real-filesystem escape regressions

Create `tests/skills/CommunitySkillsCache.spec.ts` and extend registry/import suites. Use a temp root plus outside sentinels. Cover malicious:

- IDs/names: `../outside`, `/absolute`, `C:\\outside`, UNC, backslash, NUL, empty, dot segments, overlong/invalid slug;
- source directories and files with absolute/traversal/mixed separators, query/fragment, empty segment;
- map keys independent of the registry's declared `files`;
- poisoned cached registry/directory loaded from disk;
- `force:true` where the derived directory would escape and remove an outside sentinel;
- symlinked cache/install child pointing outside.

Assert validation happens before network fetch where possible, before `fs.remove`/write, and before hook/scanner/telemetry callbacks.

**Verify**: the focused cache/import tests fail only on new expectations.

### Step 2: Implement shared pure validators

Create `communitySkillPaths.ts` with:

- install identifier validation that delegates to `isValidSkillName`;
- safe relative POSIX source/file validation returning a canonical unchanged path;
- a contained destination resolver under an explicit root;
- an async existing-ancestor/symlink safety check for filesystem sinks;
- whole-map validation that returns a new validated map only after every key passes.

Keep errors free of secrets and stable enough for tests. The validator must not perform writes or removals.

**Verify**: add direct table tests if needed, then `bun run test tests/skills/CommunitySkillsCache.spec.ts tests/skills/GitHubRegistryFetcher.spec.ts` exits 0.

### Step 3: Reject unsafe registry entries before fetch/cache

Strengthen `validateRegistry`/`isValidSkill` so unsafe entries are rejected deterministically. Also validate directly supplied `GitHubCommunitySkill` objects in `fetchSkillDirectory`, because tests/internal callers can bypass registry ingestion. Canonicalize returned map keys to validated file paths rather than original raw strings.

Validate source URL-derived owner/repo/branch/path segments before constructing raw GitHub URLs. Preserve legitimate nested directories.

**Verify**: `bun run test tests/skills/GitHubRegistryFetcher.spec.ts` exits 0 and asserts no fetch for unsafe metadata.

### Step 4: Secure cache reads, removals, and writes

Validate `skillId` before `getSkillBody`, `setSkillBody`, `getSkillDirectory`, and `setSkillDirectory`. Validate the entire map and symlink-safe destination before `enforceMaxSkillsCache`, `fs.remove`, `ensureDir`, or write. Revalidate files read from an older cache; an unsafe cache entry is ignored/rejected and never returned for installation.

Ensure cache eviction enumerates only actual direct children and does not follow symlinks outside the skills cache.

**Verify**: `bun run test tests/skills/CommunitySkillsCache.spec.ts` exits 0 with outside sentinels intact.

### Step 5: Secure both import sinks before side effects

In `SkillsRegistry.importCommunitySkill` and `importCommunitySkillDirectory`, validate the identifier, target containment, symlink ancestors, and entire file map before existence checks that could escape, force removal, directory creation, parsing, or registration. Write only the validated map. Preserve `SKILL.md` requirement and valid nested assets.

Keep failure results compatible (`success:false`, readable `error`, and `skipped` only for a valid existing skill).

**Verify**: `bun run test tests/skills/SkillsRegistry.community.spec.ts tests/skills/SkillsRegistry.spec.ts` exits 0.

### Step 6: Unify interactive and shared installer validation

Replace partial local helpers in `skills-install.ts` with the shared validator. Make `installSkillWithSecurity` validate metadata and cached/fetched maps before scanning, hooks, import, activation, or telemetry. Unsafe cached data must not bypass fresh registry validation. Ensure CLI, runtime tool, RPC paths, bootstrap, and auto-skill callers all reach the same shared sink.

Preserve displayed name, catalog ID, frontmatter name, scope, hook payloads, and telemetry fields for valid skills.

**Verify**:

```sh
bun run test tests/skills/communityInstaller.test.ts tests/commands/skills-install.spec.ts tests/commands/skills-install-fallback.spec.ts
bun run test tests/tools/install-agent-skill.test.ts tests/core/agent.skillTools.spec.ts
```

All pass.

### Step 7: Run full gates

**Verify**:

```sh
bun run test
bun run lint
bun run proof
```

Every command exits 0.

## Test plan

- Table-driven path syntax across POSIX/Windows/mixed forms.
- Real outside sentinel for cache read/write/remove and force install.
- Symlinked destination/ancestor escape.
- Poisoned old cache revalidation.
- Direct fetch object bypass.
- Valid nested templates/scripts and ordinary install/activation regression.
- Assert no fetch, scanner, hook, parser, telemetry, or partial write occurs before validation.

## Done criteria

- [x] Registry, cache, interactive install, runtime install, and import sinks use one policy.
- [x] No untrusted ID/name/file key or pre-existing symlink can escape cache or install roots; the same-user concurrent replacement limit is recorded in `plans/README.md`.
- [x] No validation happens after remove/write/side-effect callbacks.
- [x] Poisoned cached data is revalidated and cannot install.
- [x] Valid nested skill assets still work.
- [x] No collision-prone sanitization was added.
- [x] Focused and full tests, lint, and proof pass; index updated.

## STOP conditions

Stop and report if:

- Any validation occurs after `fs.remove`, `ensureDir`, write, hook, scanner, activation, or telemetry.
- Unsafe cached content can bypass network-time checks.
- Valid nested assets stop installing.
- Interactive and noninteractive installers retain different safety rules.
- Catalog reality requires a filesystem name that violates `isValidSkillName`; report samples and request a product/data migration decision.
- Correctness requires changing public skill/SDK contracts or adding a dependency.

## Maintenance notes

- Treat every cache as untrusted input, even when it was created locally by an older version.
- New skill acquisition surfaces must terminate in the shared validator/import sink.
- Reviewers should inspect pre-removal ordering and symlink handling carefully.
