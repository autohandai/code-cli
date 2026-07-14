# Plan 005: Validate cloud-sync paths, credentials, URLs, and finalization

> **Executor instructions**: Follow this plan exactly and write failing tests before production changes. Run every gate. Stop and report on a STOP condition. Update `plans/README.md` when complete unless a reviewer owns it.
>
> **Drift check (run first)**: `git diff --stat 292a304..HEAD -- src/sync/SyncService.ts src/sync/SyncApiClient.ts src/sync/types.ts tests/sync/SyncService.test.ts tests/sync/integration.test.ts tests/sync/encryption.test.ts docs/config-reference.md`

## Status

- **Status**: DONE (verified 2026-07-14)
- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `292a304`, 2026-07-11

## Why this matters

The sync server controls manifest paths and transfer URLs. The client currently joins remote paths directly under its local base, sends the application bearer token to any returned URL, and advances successful sync state even when upload finalization returns `{success:false}`. A compromised/misconfigured response could write or delete outside the sync root, exfiltrate credentials, or report/persist a sync that the server never committed.

## Baseline state at planned commit

- `src/sync/SyncService.ts:231-280` downloads to and deletes `path.join(this.basePath, file.path)` without remote-path validation.
- The force path at `src/sync/SyncService.ts:695-731` duplicates the same behavior.
- Upload reads at lines 293-323 and 742-764 also trust manifest paths and silently skip missing URLs/failures.
- `src/sync/SyncApiClient.ts:189-214` and `308-320` accept any URL and attach `Authorization: Bearer <application token>` whenever a token is supplied.
- `SyncApiClient.completeUpload` returns a `SyncResult` with `success:false` for HTTP/network failure.
- Both callers at `SyncService.ts:325-335` and `759-775` ignore finalization and then return/save success.
- `tests/sync/integration.test.ts` currently asserts bearer forwarding to generated transfer URLs; replace that unsafe assertion with origin-aware behavior, not a blanket header deletion if the backend uses same-origin authenticated proxies.
- Config encryption/merge behavior is already tested in `tests/sync/encryption.test.ts` and must remain unchanged.

### Required trust policy

1. Remote manifest/file keys are protocol-relative POSIX paths only: non-empty, no NUL, no backslash, no absolute/drive/UNC form, no `.`/`..` segment, and no normalized escape.
2. A destination must resolve inside `basePath`, inside an enabled sync root, and through no symlinked existing ancestor that escapes the root.
3. Validate the whole remote manifest before comparison, requesting URLs, writing, or deleting. Revalidate at each filesystem sink as defense in depth.
4. Parse every transfer URL. The application bearer token may be attached only when the URL origin exactly equals configured API `baseUrl`. Cross-origin presigned URLs receive no application credential.
5. Cross-origin transfer URLs must use HTTPS. Allow HTTP only for configured same-origin development/loopback endpoints already supported by tests.
6. Missing URLs, requested transfer failures, or failed finalization make the sync fail. Do not persist `.sync-state.json` or emit `sync_completed` success.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Service | `bun run test tests/sync/SyncService.test.ts` | exit 0 |
| API integration | `bun run test tests/sync/integration.test.ts` | exit 0 |
| Encryption regression | `bun run test tests/sync/encryption.test.ts` | exit 0 |
| i18n if messages change | `bun run test tests/i18n/i18n.test.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Proof | `bun run proof` | exit 0 |

## Scope

**In scope**:

- `src/sync/SyncService.ts`
- `src/sync/SyncApiClient.ts`
- `src/sync/types.ts`
- A small `src/sync/pathSafety.ts` module is allowed because validation is shared across normal/force paths and sinks.
- `tests/sync/SyncService.test.ts`
- `tests/sync/integration.test.ts`
- `tests/sync/encryption.test.ts`
- `docs/config-reference.md` only if sync trust behavior is documented there.

**Out of scope**:

- Authentication token format, config encryption algorithm, API endpoints, event names, CLI `/sync` contract, or environment variable names.
- Server-side changes.
- Atomic cross-process locking/state indexes; that separate audited item was completed in the integrated post-plan delivery recorded in `plans/README.md`.
- Deleting or sanitizing unsafe remote names into alternate local names; unsafe data must fail explicitly.
- New dependencies.

## Git workflow

- Branch: `advisor/005-cloud-sync-trust-boundary`
- Commit title: `Validate cloud sync data before local mutation`
- Body must mention cross-origin credential stripping and finalization failure propagation.
- Append `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`.
- Do not push unless instructed.

## Steps

### Step 1: Reproduce remote path traversal at real sinks

Add temp-filesystem tests for remote paths containing:

- `../outside`, nested normalized escapes, absolute POSIX paths;
- Windows drive, UNC, and backslash traversal on every platform;
- NUL, empty, `.`, and duplicate separator segments;
- a symlinked directory inside `basePath` pointing outside;
- malicious entries in downloads, conflicts, local deletes, and force download.

Place sentinel files outside `basePath` and assert no outside write/delete and no URL request occur. A malicious manifest should fail as a whole with a stable non-secret error.

**Verify**: `bun run test tests/sync/SyncService.test.ts` fails only on the new path cases.

### Step 2: Implement one contained sync-path resolver

Create a pure lexical validator plus a sink resolver. Canonicalize relative separators as POSIX only; reject rather than rewrite unsafe input. Use `path.resolve` and `path.relative` for containment. Walk existing ancestors with `lstat`/`realpath` so a symlink cannot escape. Check the enabled sync-root allowlist used by local manifest creation; remote data must not introduce arbitrary files under `AUTOHAND_HOME`.

Validate every remote manifest entry immediately after `getRemoteManifest`. Use the same helper for upload reads, download writes, and local deletes in both normal and force paths. Consolidate duplicated transfer helpers where doing so reduces the chance of one path bypassing validation.

**Verify**: `bun run test tests/sync/SyncService.test.ts tests/sync/encryption.test.ts` exits 0.

### Step 3: Reproduce and fix credential forwarding

In `tests/sync/integration.test.ts`, add distinct cases:

- exact configured API origin receives application authorization when used as an authenticated proxy;
- cross-origin HTTPS presigned upload/download receives no `Authorization` header;
- cross-origin HTTP, invalid URLs, credential-bearing URLs, and unsupported protocols are rejected before fetch;
- base URL path differences do not matter, but origin (scheme/host/port) must match exactly.

Implement origin-aware headers inside `SyncApiClient`; do not trust a caller-provided boolean or server-returned metadata to authorize a foreign origin. Never include the token in errors/logs.

**Verify**: `bun run test tests/sync/integration.test.ts` exits 0.

### Step 4: Make partial transfer and finalization failure terminal

Add failing tests for:

- a requested path missing from `uploadUrls` or `downloadUrls`;
- one upload/download rejecting while others succeed;
- `completeUpload` resolving `{success:false,error:'...'}`;
- finalization throwing;
- no `.sync-state.json`, no success event, and a false aggregate result in each case.

Require all requested uploads to finish successfully before calling finalization. Check the returned result. Do not publish a full manifest after partial upload. For downloads, fail the operation rather than reporting a fully successful sync when a requested file was skipped. Preserve accurate uploaded/downloaded counters in the failure result.

**Verify**: `bun run test tests/sync/SyncService.test.ts tests/sync/integration.test.ts` exits 0.

### Step 5: Preserve config encryption, events, and messages

Prove `config.json` still strips unsynced fields, encrypts/decrypts allowed secrets, and merges local-only values. Keep current event names and `/sync` return shape. If new user-facing errors pass through localized command UI, reuse an existing generic error key or add every supported locale key according to project convention.

**Verify**: `bun run test tests/sync/encryption.test.ts tests/i18n/i18n.test.ts` exits 0.

### Step 6: Run full gates

**Verify**:

```sh
bun run test tests/sync/SyncService.test.ts tests/sync/integration.test.ts tests/sync/encryption.test.ts
bun run test
bun run lint
bun run proof
```

Every command exits 0.

## Test plan

- Path syntax matrix including POSIX/Windows/mixed separators and normalized forms.
- Real symlink ancestor escape with outside sentinels.
- Every sink and normal/force code path.
- Exact-origin versus foreign-origin transfer auth and scheme validation.
- Missing URL, partial transfer, finalization false/throw, state/event absence.
- Existing config encryption/merge and event result counters.

## Done criteria

- [x] No network-controlled remote path or pre-existing symlink can write/read/delete outside enabled sync roots; the same-user concurrent replacement limit is recorded in `plans/README.md`.
- [x] The entire remote manifest is validated before remote/local side effects.
- [x] Cross-origin transfer requests never receive the application bearer token.
- [x] Invalid/insecure transfer URLs fail before fetch.
- [x] Missing/failed transfers and failed finalization return failure and do not save success state.
- [x] Config encryption and public sync shapes remain compatible.
- [x] Focused tests, full tests, lint, and proof pass; index updated.

## STOP conditions

Stop and report if:

- The backend contract cannot distinguish presigned foreign URLs from authenticated same-origin proxy URLs. Do not send credentials cross-origin while waiting for clarification.
- Any validated path can escape through a symlink.
- A partial upload can still finalize/publish the full manifest.
- Failure can still write `.sync-state.json` or emit success.
- Correctness requires server/API/environment renaming or an out-of-scope lock redesign.
- Tests fail twice after a focused correction.

## Maintenance notes

- Every new synced category must be added to the allowlisted roots and covered by traversal tests.
- Reviewers should inspect credential headers and every filesystem sink, not only manifest parsing.
- Atomic locking/state persistence was intentionally separated from this slice and completed in the integrated post-plan delivery.
