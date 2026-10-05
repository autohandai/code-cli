/** @license Apache-2.0 */
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { UsageScreen } from '../../../src/ui/ink/components/UsageScreen.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import type { UsageReportData } from '../../../src/usage/usageReport.js';
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };
const data: UsageReportData = { generatedAt: '2026-10-05T12:00:00Z', totalSessions: 0, sessions: [], capabilities: [], extensions: [], warnings: [] };
afterEach(cleanup);

describe('usage screen keyboard navigation', () => {
  it('fits a small terminal, changes tabs and ranges, loads traces lazily and closes on Escape', async () => {
    const load = vi.fn(async () => data);
    const traces = vi.fn(async () => null);
    const close = vi.fn();
    const view = render(<ThemeProvider><UsageScreen loadReport={load} loadAccount={async () => null} loadTraces={traces} account="Local profile" onClose={close} rows={24} columns={60} /></ThemeProvider>);
    await flush();
    expect(traces).not.toHaveBeenCalled();
    expect(stripAnsi(view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    view.stdin.write('2'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Session tokens');
    view.stdin.write('r'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('30d');
    view.stdin.write('7'); await flush();
    expect(traces).toHaveBeenCalledOnce();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Trace monitoring');
    view.stdin.write('\x1b'); await flush();
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('keeps session details selected when Enter is pressed again', async () => {
    const sessions = ['First session', 'Second session'].map((title, index) => ({
      sessionId: String(index), title, createdAt: data.generatedAt, lastActiveAt: data.generatedAt,
      projectPath: '/work', projectName: 'work', model: 'moa', messageCount: 2, status: 'completed' as const,
    }));
    const view = render(<ThemeProvider><UsageScreen loadReport={async () => ({ ...data, sessions, totalSessions: 2 })} loadAccount={async () => null} loadTraces={async () => null} account="Local" onClose={() => {}} rows={30} columns={100} /></ThemeProvider>);
    await flush(); view.stdin.write('6'); await flush();
    view.stdin.write('\x1b[B'); await flush(); view.stdin.write('\r'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Second session');
    view.stdin.write('\r'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Second session');
    view.unmount();
  });

  it('aborts pending loads on unmount and renders source errors as recoverable states', async () => {
    let signal: AbortSignal | undefined;
    const view = render(<ThemeProvider><UsageScreen loadReport={async (_query, requestSignal) => { signal = requestSignal; throw new Error('offline'); }} loadAccount={async () => null} loadTraces={async () => null} account="Local" onClose={() => {}} rows={20} columns={60} /></ThemeProvider>);
    await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Unable to load');
    view.unmount(); await flush();
    expect(signal?.aborted).toBe(true);
  });
});

describe('trace report lifecycle', () => {
  it('shows trace provenance and cancels the trace request when leaving the tab', async () => {
    let signal: AbortSignal | undefined;
    const map = {
      sessions: { total: 3, tokens: 400, durationMs: 2000, usageProvenance: { actual: 2, estimated: 1, unavailable: 0 } },
      outcomes: { verified: 1, completedUnverified: 1, failed: 1 },
      coverage: { filesScanned: 3, partial: true, warnings: 1 },
      verification: { testsPassed: 4, testsFailed: 1, lintPassed: 1, buildPassed: 0, proofPassed: 0 },
      tools: [{ category: 'test', calls: 6, errors: 1 }], dimensions: {}, workflows: [], generatedAt: data.generatedAt,
    } as unknown as import('../../../src/integrations/ahtraces/workMap.js').WorkMap;
    const view = render(<ThemeProvider><UsageScreen loadReport={async () => data} loadAccount={async () => null} loadTraces={async (_query, requestSignal) => { signal = requestSignal; return map; }} account="Local" onClose={() => {}} rows={30} columns={100} /></ThemeProvider>);
    await flush(); view.stdin.write('7'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('2 actual / 1 estimated / 0 unavailable');
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Tests passed 4');
    view.stdin.write('1'); await flush();
    expect(signal?.aborted).toBe(true);
    view.unmount();
  });
});
