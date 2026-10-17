/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RepositoryReadiness } from '../core/agent/RepositoryReadiness.js';

export const metadata = {
  command: '/readiness', description: 'review repository findings and choose whether to act', implemented: true,
  subcommands: [{ name: 'apply', description: 'Act on selected findings' }, { name: 'dismiss', description: 'Skip these findings' }],
};
interface ReadinessContext {
  repositoryReadiness?: Pick<RepositoryReadiness, 'getReport' | 'dismiss'> | null;
  enqueueInstruction?: (instruction: string) => void;
}
export async function readiness(ctx: ReadinessContext, args: string[] = []): Promise<string> {
  const service = ctx.repositoryReadiness;
  if (!service) return 'Repository readiness is unavailable. Enable ui.repositoryReadiness in an interactive session.';
  if (args[0] === 'dismiss') { await service.dismiss(); return 'Repository suggestions dismissed. Materially new findings can be offered in a later session.'; }
  const report = service.getReport();
  if (!report) return 'Repository readiness is still being assessed, or the review could not finish. Your work can continue.';
  if (args[0] === 'apply') {
    const indexes = args.slice(1).length ? args.slice(1).map(value => Number(value) - 1) : report.findings.map((_, index) => index);
    if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= report.findings.length)) return 'Choose an existing finding number, for example /readiness apply 1.';
    const selected = [...new Set(indexes)].map(index => report.findings[index]!);
    const instruction = [
      'Review and address these repository-readiness findings that I selected:',
      ...selected.map(finding => `${finding.title}: ${finding.detail}\nEvidence paths: ${finding.paths.join(', ')}`),
      'Recheck current repository instructions, git status, implementations and tests. These are startup observations, not confirmed defects. Establish evidence before editing; stop if the finding no longer applies.',
      'Make only narrow changes supported by that evidence. Preserve behavior and unrelated work. Write a failing test before a bug fix, characterize behavior before simplification, and run relevant tests and repository validation.',
      'Ask before deleting files, breaking changes, new dependencies, or initializing Zit. Do not commit, push, or deploy without my explicit authorization.',
    ].join('\n\n');
    if (!ctx.enqueueInstruction) return instruction;
    ctx.enqueueInstruction(instruction);
    return 'Queued your selected repository review.';
  }
  return [
    'Repository readiness', report.mentalModel || 'A bounded repository review completed.',
    ...report.findings.map((finding, index) => `${index + 1}. ${finding.title}\n   ${finding.detail}\n   Evidence: ${finding.paths.join(', ')}`),
    report.findings.length ? 'Choose /readiness apply 1 (or other numbers), /readiness apply for all, or /readiness dismiss. Leaving these suggestions alone makes no changes.' : 'No concrete improvements found in the sampled repository context.',
  ].join('\n\n');
}
