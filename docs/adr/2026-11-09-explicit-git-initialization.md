# Startup observes Git; repository creation is explicit

## Context

Squad reported failed Git initialization when a conversation used an empty
default folder. Not every workspace is a source repository. Startup checks
considered hidden files insignificant and ran `git init` for an otherwise empty
directory, also creating a macOS `.gitignore`. That happened before the composer on normal terminal/direct-CLI startup.
The first cross-repository diagnosis overgeneralized this to RPC: current
protocol launches route before these checks, so the branch alone is not evidence
that RPC startup initializes Git. Disabling all startup with bare mode would also
disable unrelated instructions, hooks and integrations.

The previous tests explicitly expected automatic initialization. Updated tests
failed in five cases before the source change: empty and hidden-file-only
folders, repeated startup, Git being optional, and a folder containing only an
existing ignore file.

## Decision

Remove the empty-directory initialization branch. Startup still checks access,
detects existing Git metadata and reads branches; it never creates `.git` or
`.gitignore`. Git is optional for general chat and file work. Git operations
still require the executable and an explicitly chosen repository. Keep the
legacy `workspace.initialized` result field as false for callers that read it.

Repository creation is a separate explicit user request, through Git itself or
the agent's normal tool approval path. No new startup flag or blanket bare-mode
override is introduced.

## Evidence

The updated startup suite and branding suite pass together (26 tests). The
built CLI Tuistory case reaches the actual composer in an empty non-Git folder,
confirms no `.git` or `.gitignore` was created, and exits interactively. This
test does not call a live model provider. Build succeeds. Aggregate lint/proof
results are recorded with the change's validation receipt.

The complete `bun run proof` ran on Node 26.7.0: lint/type checking and the
unit stage passed (963 files, 13,779 tests; 6 files and 80 tests skipped).
The terminal stage finished with 106 files passing and three failures among
536 tests: mouse/scroll exit, slash-command browsing and Console connectors.
A focused retry passed the first two (27 tests across those files); the
connector case still timed out waiting for tools/list. The same connector
test also fails at that assertion in an unmodified worktree at base commit
9d10d59d51442bd60ca35ee04234da63ae83370e. This establishes that connector
failure separately from the startup patch; it does not make aggregate proof
green. CI uses its own pinned runtime and remains an independent check.

## Consequences

New empty folders no longer acquire version control automatically. People who
want Git must explicitly initialize it. Existing repositories keep their branch
display; non-Git folders keep file work and chat. Features that require Git may
report that a repository is needed when invoked. This does not prohibit Git
tools or erase existing repositories, and it does not make unrelated runtime
startup read-only: the ordinary workspace/session infrastructure still runs.
