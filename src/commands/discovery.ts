/** @license Apache-2.0 */
import { runDiscoveryPreview } from '../discovery/preview.js';

export const metadata = {
  command: '/discovery',
  description: 'preview useful workflows from the current workspace',
  implemented: true,
};

export async function discovery(ctx: { workspaceRoot: string; commandSignal?: AbortSignal }, args: string[] = []): Promise<string> {
  if (args.length) return 'Usage: /discovery\nPreviews the current workspace locally without writing drafts or making model requests.';
  try {
    return formatDiscoveryPreview(await runDiscoveryPreview({ workspaceRoot: ctx.workspaceRoot, signal: ctx.commandSignal }));
  } catch (error) {
    if (ctx.commandSignal?.aborted) return 'Discovery cancelled.';
    return failureText(error);
  }
}

/**
 * A failed scan is this command's answer, not a session fault: thrown, it would
 * mark the session crashed and be printed where a full-screen session cannot show it.
 */
function failureText(error: unknown): string {
  return (error instanceof Error && error.message.trim()) || 'Local discovery preview failed.';
}

const SKIPPED_SKILL_NOTE = /^(\s*)Note: Skipped unreadable or invalid skill: (.+)$/;
const HIDDEN_NOTES = /^(\s*)(\d+) additional notes in \.autohand\/discovery\.json\.$/;
const SKIPPED_SKILL_EXAMPLES = 2;

/**
 * Keeps the collector's report readable in a transcript: one line per skipped
 * skill pushes the heading and summary off the screen, and the collector points
 * at a notes file that a preview never writes.
 */
export function formatDiscoveryPreview(report: string): string {
  const lines = report.split('\n');
  const skippedSkills = lines.flatMap(line => SKIPPED_SKILL_NOTE.exec(line)?.[2] ?? []);
  const collapse = skippedSkills.length > SKIPPED_SKILL_EXAMPLES;
  const truncated = lines.some(line => HIDDEN_NOTES.test(line));
  let summarised = false;

  return lines.flatMap((line) => {
    const hidden = HIDDEN_NOTES.exec(line);
    if (hidden) return [hiddenNotesLine(hidden[1], Number(hidden[2]))];

    const skipped = collapse ? SKIPPED_SKILL_NOTE.exec(line) : null;
    if (!skipped) return [line];
    if (summarised) return [];
    summarised = true;
    const indent = skipped[1];
    return [
      `${indent}Note: Skipped ${truncated ? 'at least ' : ''}${skippedSkills.length} unreadable or invalid skills, including:`,
      ...skippedSkills.slice(0, SKIPPED_SKILL_EXAMPLES).map(skill => `${indent}      ${skill}`),
    ];
  }).join('\n');
}

function hiddenNotesLine(indent: string, count: number): string {
  const subject = count === 1 ? '1 more note is' : `${count} more notes are`;
  return `${indent}${subject} not shown. Run "autohand discovery" to save every note to .autohand/discovery.json.`;
}
