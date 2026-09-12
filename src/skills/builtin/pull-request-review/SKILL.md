---
name: pull-request-review
description: Review a pull request or branch diff like a staff engineer. Verify it does what the issue asks, find correctness and security defects with file and line evidence, check tests and compatibility, and deliver prioritized, actionable comments. Use for PR review, branch review, and "review my changes".
allowed-tools: read_file find_grep fff_find list_tree git_status git_diff git_diff_range git_log run_command code_review
---

# Review the change, not the style guide

A useful review finds the defect that would have shipped and explains it so the
author can fix it in one pass.

## Establish scope

1. Get the diff (`git_diff` for the working tree, `git_diff_range` against the
   base branch). Read the whole diff before commenting on any part.
2. Read the linked issue, PR description, or commit messages. Write one line
   stating what the change claims to do.
3. Open the files around the diff; a change is only correct in context.

## Check in this order

1. **Does it do what it says**: every requirement from the issue is met, no
   silent scope changes, no leftover debug code or TODOs.
2. **Correctness**: edge cases, error paths, concurrency, ordering, off-by-one,
   null and empty inputs, resource cleanup, timeouts.
3. **Security**: injection, path traversal, secrets, permission checks,
   unsafe deserialization, shell execution with user input.
4. **Compatibility**: public API, config, storage formats, migrations, feature
   flags, older callers.
5. **Tests**: a test fails before and passes after for each fix; new behavior
   has coverage including edge cases; flaky patterns (sleeps, real network).
6. **Maintainability**: naming, duplication, module boundaries, comments only
   where logic is non-obvious.

Run the tests and lint yourself when the environment allows; a review with
evidence beats one with opinions.

## Deliver

- Verdict first: approve, approve with nits, or request changes, in one line.
- Findings ordered by severity. Each: file:line, what is wrong, why it matters,
  a concrete fix. Mark confidence when you could not verify.
- Separate blocking from optional. Keep nits short or drop them.
- Say what you did not review.
