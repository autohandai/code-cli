/** @license Apache-2.0 */
import { describe, expect, it, vi } from 'vitest';
import { aggregateUsageReport } from '../../src/usage/usageReport.js';
import type { SessionMetadata } from '../../src/session/types.js';

const now = new Date('2026-10-05T12:00:00Z');
const session = (id: string, usage?: SessionMetadata['usage']): SessionMetadata => ({
  sessionId: id, createdAt: '2026-09-01T10:00:00Z', lastActiveAt: '2026-10-04T12:00:00Z',
  projectPath: '/work', projectName: 'work', model: 'moa', messageCount: 25, status: 'completed', usage,
});

describe('usage report aggregation', () => {
  it('keeps unknown usage unknown and groups session totals by last activity, without inventing daily token usage', () => {
    const report = aggregateUsageReport([
      session('known', { totalTokens: 120, promptTokens: 100, completionTokens: 20, turnCount: 2, tokenUsageStatus: 'actual', updatedAt: now.toISOString(), longestTurnDurationMs: 2000 }),
      session('unknown'),
    ], [], 7, now);
    expect(report.tokens).toBe(120);
    expect(report.unknownSessions).toBe(1);
    expect(report.days.find(day => day.date === '2026-10-04')?.tokens).toBe(120);
    expect(report.messages).toBe(50);
    expect(report.longestTurnMs).toBe(2000);
    expect(report.days).toHaveLength(7);
  });

  it('deduplicates sessions and capability events and excludes out-of-range or invalid dates', () => {
    const event = { id: 'one', date: '2026-10-04T10:00:00Z', kind: 'skill' as const, name: 'review', source: 'extension', project: '/work', failed: false };
    const report = aggregateUsageReport([session('same'), session('same'), { ...session('old'), lastActiveAt: '2026-08-01' }], [event, event, { ...event, id: 'old', date: 'invalid' }], 7, now);
    expect(report.sessions).toHaveLength(1);
    expect(report.skills).toEqual([{ name: 'review', source: 'extension', uses: 1, failed: 0 }]);
    expect(report.days.find(day => day.date === '2026-10-04')?.skills).toBe(1);
  });
});

describe('usage report sources', () => {
  it('bounds capability log reads and marks malformed or omitted records as partial', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readCapabilityActivity } = await import('../../src/usage/usageReport.js');
    const root = await mkdtemp(join(tmpdir(), 'usage-report-'));
    try {
      const directory = join(root, '.autohand', 'memory', 'events');
      await mkdir(directory, { recursive: true });
      const event = { operation: 'capability_used', eventId: 'skill-1', occurredAt: now.toISOString(), capability: { kind: 'skill', name: 'review', source: 'project' }, outcome: 'succeeded' };
      await writeFile(join(directory, 'LOG.jsonl'), `${' '.repeat(300000)}\ninvalid\n${JSON.stringify(event)}\n`);
      const result = await readCapabilityActivity(root, new AbortController().signal);
      expect(result.partial).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].name).toBe('review');
      const controller = new AbortController(); controller.abort();
      await expect(readCapabilityActivity(root, controller.signal)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('loads a bounded project cohort, includes live metadata once, and reports partial source failure', async () => {
    const { loadUsageReport } = await import('../../src/usage/usageReport.js');
    const list = vi.fn(async () => ({ sessions: [session('live')], total: 2000 }));
    const live = { ...session('live'), messageCount: 27 };
    const context = { workspaceRoot: '/nonexistent-usage-test', sessionManager: { listRecentSessions: list, getCurrentSession: () => ({ metadata: live }) }, extensionService: { list: async () => { throw new Error('unavailable'); } } } as unknown as import('../../src/core/slashCommandTypes.js').SlashCommandContext;
    const result = await loadUsageReport(context, { scope: 'project', days: 7 }, new AbortController().signal);
    expect(list).toHaveBeenCalledWith({ project: '/nonexistent-usage-test' }, 1000);
    expect(result.sessions).toEqual([live]);
    expect(result.warnings).toContain('Extension inventory unavailable.');
    expect(result.warnings.some(warning => warning.includes('Partial history'))).toBe(true);
  });
});
