---
name: git-analysis
description: Answer questions from repository history, including what changed, when, by whom, why a line exists, which commits touched an area, where a regression entered, and how branches relate. Use for blame, bisect-style narrowing, changelog drafting, and release diffs.
allowed-tools: read_file find_grep git_log git_diff git_diff_range git_status git_branch run_command
---

# Read the history, not just the tree

Git already knows most of what a reviewer wants to ask. Use it before reading
code, and cite commits.

## Techniques

- **What changed between X and Y**: `git_diff_range`, then group by module;
  summarize behavior changes, not file lists.
- **Why does this line exist**: `git blame -L` through `run_command`, then
  `git show` the commit and read its message and the surrounding diff.
- **When did it break**: find the last known good and first known bad, then
  narrow with `git bisect run <test command>` when a test exists; otherwise
  bisect by hand on the commits touching the area (`git log -- <path>`).
- **Who owns this area**: `git shortlog -sn -- <path>` and recent authors.
- **What is risky in this release**: largest diffs, files with many recent
  touches, changes without tests, dependency bumps.
- **Branch relationships**: `git log --oneline --graph`, merge bases, commits
  not yet in main.

## Rules

- Quote commit hashes and dates; never paraphrase a commit message as fact
  without showing it.
- Read-only by default. Do not rebase, reset, or rewrite history unless the
  user asks for that specific operation and confirms.
- Large histories: bound queries with paths, `--since`, and `-n`.

## Output

A short narrative with the commits that matter, then a table of commit, date,
author, summary, and the evidence line for each claim. End with the open
questions the history cannot answer.
