---
name: architecture-breakdown
description: Map an unfamiliar codebase or subsystem into modules, boundaries, data flow, entry points, and hot spots, and produce a breakdown other engineers can navigate by. Use before large changes, onboarding, or when asked how something is structured.
allowed-tools: read_file find_grep fff_find list_tree file_stats git_log run_command
---

# Break the architecture down

Produce a map, not a summary. The reader should be able to open the right file
for any responsibility without searching.

## Survey

1. Entry points: binaries, `main`, CLI commands, HTTP routes, jobs, event
   handlers. Find them from the build config and manifests, then follow imports.
2. Layers and boundaries: what talks to what. Note the direction of
   dependencies and any cycles.
3. State: where data lives (stores, caches, files), who owns each piece, and
   how it moves between layers.
4. Cross-cutting concerns: config, auth, logging, errors, retries, feature
   flags, i18n.
5. Hot spots: largest files, most-changed files (`git_log --stat` style via
   `run_command`), most-imported modules. These are where changes hurt.

## Write the breakdown

- **One-paragraph shape**: what the system is and its top three modules.
- **Module table**: module, responsibility, key files, depends on, depended on
  by, owner if known.
- **Data flow**: two or three end-to-end traces from entry point to effect,
  with file:line references.
- **Boundaries to respect**: the seams that keep layers separate and the rules
  the code already follows.
- **Risks**: cycles, god files, duplicated logic, missing tests, hidden global
  state, with evidence.
- **Where to start** for the change the user has in mind.

Keep every claim tied to a path. Mark inferences. Do not propose rewrites unless
asked; the breakdown exists so changes fit the structure that is there.
