/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const AGENTS_MD_SECTIONS = [
  'Project overview',
  'Architecture map',
  'Commands',
  'Testing workflow',
  'Conventions',
  'Constraints',
  'Definition of done',
] as const;

/**
 * The turn that writes AGENTS.md from what the repository actually contains.
 * It runs as a normal background instruction, so the composer stays free and
 * the user can watch or cancel it like any other work.
 */
export function buildInitInstruction(workspaceRoot: string): string {
  return [
    `Create an AGENTS.md at the root of the workspace ${workspaceRoot} that tells a coding agent how to work in this repository.`,
    '',
    'Investigate before writing, using only what the repository contains:',
    '- List the top two levels of the tree and identify entry points, main modules, and where tests live.',
    '- Read the package manifests and lockfiles (package.json, Cargo.toml, pyproject.toml, go.mod, Gemfile, or equivalents) and take commands only from their scripts and documented tooling.',
    '- Read README, CONTRIBUTING, existing AGENTS.md-style files, CI workflows, and editor or lint configs for conventions already in force.',
    '- Sample two or three source files and two test files to confirm the style and testing patterns actually used.',
    '',
    `Then write AGENTS.md with exactly these sections, in this order: ${AGENTS_MD_SECTIONS.map((section) => `"${section}"`).join(', ')}.`,
    '- Project overview: what the software is and does, in three lines or fewer.',
    '- Architecture map: the main modules with their paths and one-line responsibilities, and the seams a change should respect.',
    '- Commands: install, dev, build, test, lint, and format, each as the exact command found in the repository. Never invent a command; omit a line you could not verify.',
    '- Testing workflow: the framework, where tests go, how to run one file, and what must pass before work is done.',
    '- Conventions: language settings, patterns observed in the code, naming, error handling, and anything the lint config enforces.',
    '- Constraints: what an agent must not do here (files outside the project, secrets, breaking changes without asking, new dependencies without reason).',
    '- Definition of done: tests and lint green, the change verified the way this project verifies things, and no unrelated edits.',
    '',
    'Keep the file under 150 lines, plain Markdown, no marketing language. Write it with the write_file tool, then reply with a five-line summary of what you found and any command you could not verify.',
  ].join('\n');
}
