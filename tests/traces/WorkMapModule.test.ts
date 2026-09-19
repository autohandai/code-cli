import { describe, expect, it, vi } from 'vitest';
import type { NormalizedTrace, TraceHarness } from '../../src/traces/model.js';
import type { TraceSourceAdapter, TraceSourceRegistry } from '../../src/traces/adapters/sourceRegistry.js';
import { WorkMapModule } from '../../src/traces/WorkMapModule.js';

function adapter(harness: TraceHarness, result: Partial<Awaited<ReturnType<TraceSourceAdapter['scan']>>> = {}): TraceSourceAdapter {
  return {
    harness,
    displayName: harness,
    formats: ['json'],
    locations: [],
    scan: vi.fn(async () => ({
      traces: [],
      filesScanned: 0,
      bytesRead: 0,
      warnings: [],
      truncated: false,
      sourceFiles: [],
      ...result,
    })),
  };
}

function registry(adapters: TraceSourceAdapter[]): TraceSourceRegistry {
  return {
    list: () => adapters,
    get: (harness) => adapters.find((candidate) => candidate.harness === harness),
  };
}

describe('WorkMapModule', () => {
  it('scans selected adapters, bounds concurrency, and reports partial coverage', async () => {
    let active = 0;
    let maximumActive = 0;
    const adapters = (['autohand', 'codex', 'claude-code', 'cursor'] as TraceHarness[]).map((harness) => {
      const source = adapter(harness, { warnings: harness === 'cursor' ? ['malformed'] : [] });
      vi.mocked(source.scan).mockImplementation(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return {
          traces: [],
          filesScanned: 1,
          bytesRead: 10,
          warnings: harness === 'cursor' ? ['malformed'] : [],
          truncated: harness === 'cursor',
          sourceFiles: [],
        };
      });
      return source;
    });
    const module = new WorkMapModule(registry(adapters), { maxConcurrency: 2 });

    const result = await module.map({
      since: '30d',
      harnesses: ['autohand', 'codex', 'cursor'],
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(adapters[2].scan).not.toHaveBeenCalled();
    expect(result.coverage).toMatchObject({ filesScanned: 3, warnings: 1, partial: true });
    expect(result.request.harnesses).toEqual(['autohand', 'codex', 'cursor']);
  });

  it('returns normalized traces only from the internal scan seam', async () => {
    const sample = { id: 'trace-one' } as NormalizedTrace;
    const source = adapter('autohand', { traces: [sample], filesScanned: 1 });
    const module = new WorkMapModule(registry([source]));

    const snapshot = await module.scan({ since: '30d' });

    expect(snapshot.traces).toEqual([sample]);
    expect(snapshot.coverage).toEqual([{
      harness: 'autohand',
      filesScanned: 1,
      bytesRead: 0,
      warnings: 0,
      truncated: false,
      sessions: 1,
    }]);
    expect(snapshot.sourceFiles).toEqual([]);
  });

  it('propagates cancellation instead of turning it into partial coverage', async () => {
    const source = adapter('autohand');
    vi.mocked(source.scan).mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    const module = new WorkMapModule(registry([source]));

    await expect(module.map({ since: '30d' })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
