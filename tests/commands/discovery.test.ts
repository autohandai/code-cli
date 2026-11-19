/** @license Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runDiscoveryPreview = vi.hoisted(() => vi.fn());
vi.mock('../../src/discovery/preview.js', () => ({ runDiscoveryPreview }));

import { discovery, formatDiscoveryPreview } from '../../src/commands/discovery.js';

const workspaceRoot = '/workspace with spaces';

describe('/discovery command', () => {
  beforeEach(() => { runDiscoveryPreview.mockReset(); });

  it('returns the local report for the current workspace', async () => {
    const commandSignal = new AbortController().signal;
    runDiscoveryPreview.mockResolvedValue('DISCOVERY  fixture\n\n  Suggested workflows');

    expect(await discovery({ workspaceRoot, commandSignal })).toBe('DISCOVERY  fixture\n\n  Suggested workflows');
    expect(runDiscoveryPreview).toHaveBeenCalledWith({ workspaceRoot, signal: commandSignal });
  });

  it('explains its usage without scanning when given arguments', async () => {
    const result = await discovery({ workspaceRoot }, ['push']);

    expect(result).toMatch(/^Usage: \/discovery\n/);
    expect(runDiscoveryPreview).not.toHaveBeenCalled();
  });

  it('reports a cancelled scan as cancelled, whatever the collector rejected with', async () => {
    const controller = new AbortController();
    runDiscoveryPreview.mockImplementation(async () => {
      controller.abort();
      throw new Error('Local discovery preview cancelled.');
    });

    expect(await discovery({ workspaceRoot, commandSignal: controller.signal })).toBe('Discovery cancelled.');
  });

  it('returns a failed scan as the command result so the session shows it instead of crashing', async () => {
    runDiscoveryPreview.mockRejectedValue(new Error('Local discovery preview failed.\ncollector failed [redacted]'));

    expect(await discovery({ workspaceRoot })).toBe('Local discovery preview failed.\ncollector failed [redacted]');
  });

  it.each([
    ['a timeout', new Error('Local discovery preview timed out.'), 'Local discovery preview timed out.'],
    ['an empty report', new Error('Local discovery preview returned no report.'), 'Local discovery preview returned no report.'],
    ['an error without a message', new Error(''), 'Local discovery preview failed.'],
    ['a rejection that is not an error', 'spawn failed', 'Local discovery preview failed.'],
  ])('returns readable text for %s', async (_case, rejection, expected) => {
    runDiscoveryPreview.mockRejectedValue(rejection);

    expect(await discovery({ workspaceRoot })).toBe(expected);
  });
});

const skipped = (name: string): string => `  Note: Skipped unreadable or invalid skill: .agents/skills/${name}/SKILL.md`;
const report = (notes: string[]): string => [
  'DISCOVERY  fixture',
  '',
  '  1 repositories · 754 skills · 0 user requests',
  '',
  '  Suggested workflows',
  '',
  '  01  fixture · Repository orientation',
  '      75/100 · manual · repository-onboarding',
  '',
  '  Catalogue matches',
  '  Accessibility review · 95/100',
  ...notes,
  '',
  '  Dry run: no local files written.',
  '  Preview: autohand discovery push --with-report --dry-run',
  '  Upload:  autohand discovery push --with-report',
].join('\n');

describe('discovery preview formatting', () => {
  it('collapses the per-skill skip notes into one count with the first examples', () => {
    const formatted = formatDiscoveryPreview(report([
      '  Note: .: No supported CI configuration found within the scan limits.',
      '  Note: User skill directory limit reached.',
      ...['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(skipped),
    ]));

    expect(formatted).toBe(report([
      '  Note: .: No supported CI configuration found within the scan limits.',
      '  Note: User skill directory limit reached.',
      '  Note: Skipped 5 unreadable or invalid skills, including:',
      '        .agents/skills/alpha/SKILL.md',
      '        .agents/skills/beta/SKILL.md',
    ]));
  });

  it('keeps the other notes in place when skip notes are interleaved with them', () => {
    const formatted = formatDiscoveryPreview(report([
      skipped('alpha'),
      '  Note: Git history was unavailable for ..',
      skipped('beta'),
      skipped('gamma'),
    ]));

    expect(formatted).toBe(report([
      '  Note: Skipped 3 unreadable or invalid skills, including:',
      '        .agents/skills/alpha/SKILL.md',
      '        .agents/skills/beta/SKILL.md',
      '  Note: Git history was unavailable for ..',
    ]));
  });

  it('does not claim the hidden notes were saved by a preview that writes nothing', () => {
    const formatted = formatDiscoveryPreview(report([
      ...['alpha', 'beta', 'gamma'].map(skipped),
      '  8 additional notes in .autohand/discovery.json.',
    ]));

    expect(formatted).not.toContain('additional notes in .autohand/discovery.json');
    expect(formatted).toContain('  Note: Skipped at least 3 unreadable or invalid skills, including:');
    expect(formatted).toContain('  8 more notes are not shown. Run "autohand discovery" to save every note to .autohand/discovery.json.');
  });

  it('words a single hidden note in the singular', () => {
    expect(formatDiscoveryPreview(report(['  1 additional notes in .autohand/discovery.json.'])))
      .toContain('  1 more note is not shown. Run "autohand discovery" to save every note to .autohand/discovery.json.');
  });

  it.each([
    ['no notes', report([])],
    ['a couple of skip notes, which are already short', report(['alpha', 'beta'].map(skipped))],
    ['an empty report', ''],
    ['text that is not a discovery report', 'Note: Skipped unreadable or invalid skill\nplain text'],
  ])('leaves a report with %s untouched', (_case, text) => {
    expect(formatDiscoveryPreview(text)).toBe(text);
  });

  it('formats the report the command returns', async () => {
    runDiscoveryPreview.mockResolvedValue(report(['alpha', 'beta', 'gamma'].map(skipped)));

    const result = await discovery({ workspaceRoot });

    expect(result).toContain('Skipped 3 unreadable or invalid skills, including:');
    expect(result).not.toContain('gamma');
    expect(result.startsWith('DISCOVERY  fixture')).toBe(true);
  });
});
