/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { lifecycleDelegation, startLifecycleWorkflow, type LifecycleCommandContext } from './lifecycleWorkflow.js';

export const metadata = {
  command: '/deslop',
  description: 'remove unnecessary generated complexity with behavior-preserving tests',
  implemented: true,
  subcommands: [{ name: 'help', description: 'Show cleanup scope and safety contract' }],
};

export async function deslop(ctx: LifecycleCommandContext, args: string[] = []): Promise<string | null> {
  if (args[0] === 'help' || args[0] === '--help') {
    return 'Usage: /deslop [path or cleanup objective]\nDefaults to the current working-tree diff. Preserves behavior and unrelated work; tests precede production edits.';
  }
  const scope = args.join(' ').trim();
  const prompt = [
    'Perform a narrow, behavior-preserving cleanup of unnecessary generated complexity.',
    `Workspace: ${ctx.workspaceRoot}`,
    `Target: ${scope || 'current working-tree diff'}`,
    'Inspect repository instructions, git status/diff, touched implementations, callers, and tests before making a change. An empty default diff means there is nothing to clean up; stop rather than expanding to the repository.',
    'Use code-cleaner to identify concrete redundant wrappers, impossible defensive branches, duplicate logic, misleading comments, or unnecessary abstractions in this target. Do not treat unfamiliar code, explicit types, necessary guards, or a different coding style as defects.',
    'Use tester to establish observable behavior. For each chosen simplification, add a characterization test and run it before changing production code; for an actual bug, reproduce the bug with a failing test first.',
    'Preserve public APIs, runtime behavior, security checks, error handling, compatibility, performance, and accessibility. Keep unrelated user edits intact. Ask before a behavior change, dependency change, deletion, or broad refactor.',
    lifecycleDelegation,
    'Make the smallest independently verifiable edit, then run the same tests and the relevant repository lint/typecheck/proof commands. For UI changes, exercise the actual affected interface and report visual evidence separately from test status.',
    'Do not commit, push, auto-format the entire repository, or delete files without explicit authorization.',
    'Finish with what was simplified, why behavior is preserved, exact checks and their outcomes, and any remaining uncertainty. A smaller diff without runtime evidence is not sufficient.',
  ].join('\n\n');
  return startLifecycleWorkflow(ctx, prompt, 'Starting scoped cleanup...');
}
