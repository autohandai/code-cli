# Moa review blocked by Windows temporary-index cleanup

Reported version: Autohand 0.9.9, Windows, launched from Bash. The Bash distribution and complete error path were not supplied. Investigation date: 2026-10-30.

## Confirmed failure mechanism

`ReactLoopRunner.consultAdvisor()` calls `WorkspaceChangeCapture.pending()` before requesting a Moa commit/completion review. Capture creates a unique `autohand-change-index-*` directory under the OS temporary directory, sets `GIT_INDEX_FILE`, and computes a diff without changing the user's real Git index.

Previously, `pending()` awaited `backend.dispose()` in `finally`. `dispose()` called `fs-extra.remove()`, which uses recursive, forced removal without retries. If removal failed with `EBUSY`, that rejection replaced the successfully computed diff, or masked a prior Git error. The caller turned it into `Cannot capture the workspace diff`, returned an unavailable review, and stopped completion before sending this checkpoint to Moa. The provider-review retry is downstream of this failure and cannot recover it.

A fault-injection reproduction using the actual capture module, a real temporary Git repository, and an `EBUSY` from temporary-index deletion reproduced the reported error through `dispose()` and `pending()`. This proves the application failure mechanism; it does not identify the lock holder on the reported Windows computer.

## Conditions

- Windows can reject deletion when another handle denies delete sharing, or when a file is memory-mapped. Git processes, security scanners, indexing software, and backup/sync clients are possible holders; none has been confirmed in this incident.
- Short-lived locks fail immediately because `force: true` handles missing paths, not busy files, and retries default to zero.
- A persistent handle can defeat retries too, so retries alone are insufficient.
- Native Windows Autohand/Git processes retain Windows filesystem semantics when launched from Git Bash. Bash quoting is not used by this capture path: it invokes Git through `execFile` and removes the directory through the filesystem API. A fully Linux CLI/Git installation in WSL is a different environment; launching a Windows executable from WSL still uses that executable's Windows behavior.
- The failure is exposed by the Moa review workflow, but occurs locally before its model request. The displayed run duration/token total does not establish the cause of the lock.

## Fix

Temporary-index cleanup now retries `EBUSY`, `EPERM`, `ENOTEMPTY`, `EMFILE`, and `ENFILE` three times with 100/200/300 ms waits. Exhausted or nonretryable cleanup errors emit an `AUTOHAND_DEBUG=1` diagnostic and do not replace a valid diff or the original capture error. Both normal disposal and failed initialization use the same cleanup policy. The total retry delay is bounded at 600 ms; filesystem-operation time is additional.

The Moa review is still required. A real Git snapshot/diff failure still propagates. A directory whose cleanup fails can remain in the OS temp directory; the fix does not launch background deletion loops or delete other sessions' directories.

## Windows diagnosis and recovery

1. Capture the full error path, `autohand --version`, `git --version`, `uname -a`, and `type -a autohand git` from the failing terminal. Record whether this is Git Bash/MSYS2 or WSL.
2. While the lock is present, use Microsoft's Sysinternals Handle from an elevated terminal: `handle.exe autohand-change-index`. If the path has another prefix, search for that specific path fragment. Process Explorer's handle search is an alternative. A transient lock may already be gone when inspected.
3. Let the owning operation finish or close the identified program normally, then resume the session and request review again. Do not treat the original task as complete merely because its edits exist.
4. Keep review enabled. Changing models or raising model token budgets does not repair temporary-file cleanup. Do not broadly disable antivirus or delete active sessions' temp directories.
5. For a controlled Git Bash diagnostic, launch the native CLI with a dedicated local temp directory. For example, after creating `C:\Temp\autohand-review`, use `TEMP='C:\Temp\autohand-review' TMP='C:\Temp\autohand-review' autohand`. This tests temp-location interference; it does not guarantee immunity to Windows locks.

## Validation boundaries

The pre-fix standalone reproduction and Vitest fault-injection test both reproduced the cleanup rejection. After the fix, the standalone Bun reproduction passed and all 13 focused Vitest tests passed, covering persistent EBUSY/EPERM, nonretryable cleanup failure, transient lock recovery, original Git error preservation, initialization fallback, staged/untracked capture, and real-index preservation. The final scoped TypeScript check and ESLint check also passed. The tested source and test copies were byte-for-byte identical to the working files. No native Windows execution or live Moa provider call was available during this investigation.

Focused reproduction: `bun .tmp/windows-capture-repro/probe.ts`. Focused suite, from `.tmp/windows-capture-repro`: `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --configLoader native --pool=threads`.

Repository `bun run lint`, `bun run proof`, and `bun run build` were attempted but reported missing scripts because the placeholder package manifest read as empty. They are not passing checks. No release or deployment was performed.

The local checkout has macOS `compressed,dataless` placeholders for `package.json` and Vitest configuration. Reads returned empty content; Git status also reported short reads and crashed. Tests were therefore copied byte-for-byte with the capture source into `.tmp/windows-capture-repro`, using existing dependencies and a minimal test configuration. This is focused evidence, not full repository proof or a released Windows build.

## Primary references

- [Microsoft DeleteFile documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-deletefile): delete-sharing and mapped-file constraints.
- [Microsoft Sysinternals Handle](https://learn.microsoft.com/en-us/sysinternals/downloads/handle): identify processes holding file handles.
- [Node filesystem removal documentation](https://nodejs.org/api/fs.html#fspromisesrmpath-options): retryable errors, retry defaults, and the meaning of `force`.
