---
name: systematic-debugging
description: Find the root cause before proposing any fix. Use when something fails, throws, hangs, flakes, or behaves unexpectedly, including failing tests and CI. Auto-activates for bug reports.
allowed-tools: read_file find_grep fff_find list_tree git_diff git_log git_status run_command search_with_context
---

# Debug systematically

A fix without a confirmed cause is a guess, and guesses cost more than they save.
Work the four phases in order; do not propose code before Phase 3 confirms a cause.

## Phase 1 — Reproduce and read

- Read the whole error: message, stack, exit code, the lines around it. The
  answer is often already there.
- Reproduce on purpose. Run the failing command, test, or scenario yourself with
  `run_command`. If it cannot be reproduced, gather more evidence instead of guessing.
- Note what changed: `git_log` and `git_diff` for the touched area, new
  dependencies, config, environment (CI vs local, OS, shell, terminal, load).
- For multi-layer systems, add cheap instrumentation at each boundary and run
  once to see where the data goes wrong. Fix where it originates, not where it surfaces.

## Phase 2 — Compare with what works

- Find the nearest working example in the same codebase and list every difference,
  however small. Do not assume a difference cannot matter.
- Read the reference implementation completely before adapting a pattern.

## Phase 3 — One hypothesis, one test

- Write the hypothesis down in one sentence: "X causes Y because Z."
- Test it with the smallest possible change or probe. One variable at a time.
- If it fails, form a new hypothesis. Do not stack fixes. After three failed
  fixes, stop and question the design with the user; that is an architecture
  problem, not a bug.

## Phase 4 — Fix with a regression test

- Write the failing test first; it must fail for the reason you found.
- Apply the single fix. No bundled refactors or "while I am here" edits.
- Run the test, the neighbouring suites, lint, and the project's proof command.
- Report what the cause was, what you changed, and what you verified. If the
  cause was environmental (load, disk, timing), say so with the evidence.

## Red flags that mean "back to Phase 1"

"Quick fix for now", "just try changing X", "I do not fully understand but this
might work", "one more attempt" after two failures.
