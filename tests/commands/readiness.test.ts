import { describe, expect, it, vi } from 'vitest';
import { readiness } from '../../src/commands/readiness.js';
import type { ReadinessReport } from '../../src/core/agent/RepositoryReadiness.js';

const report: ReadinessReport = { fingerprint: 'one', mentalModel: 'CLI entry point calls a typed agent runtime.', findings: [{ kind: 'simplify', paths: ['src/main.ts'], title: 'Simplify repeated setup', detail: 'Two setup branches repeat the same initialization.' }] };
describe('/readiness', () => {
  it('shows the mental model, evidence and explicit choices without queueing work', async () => {
    const enqueueInstruction = vi.fn();
    const result = await readiness({ repositoryReadiness: { getReport: () => report, dismiss: vi.fn() }, enqueueInstruction });
    expect(result).toContain(report.mentalModel); expect(result).toContain('src/main.ts'); expect(result).toContain('/readiness apply 1');
    expect(enqueueInstruction).not.toHaveBeenCalled();
  });
  it('queues only a selected finding after opt-in with instructions to recheck evidence', async () => {
    const enqueueInstruction = vi.fn();
    await readiness({ repositoryReadiness: { getReport: () => report, dismiss: vi.fn() }, enqueueInstruction }, ['apply', '1']);
    expect(enqueueInstruction).toHaveBeenCalledWith(expect.stringContaining('Simplify repeated setup'));
    expect(enqueueInstruction).toHaveBeenCalledWith(expect.stringContaining('Recheck'));
  });
  it('dismisses without model work and handles invalid selections or pending analysis', async () => {
    const dismiss = vi.fn(); const enqueueInstruction = vi.fn();
    const ctx = { repositoryReadiness: { getReport: () => report, dismiss }, enqueueInstruction };
    await readiness(ctx, ['dismiss']); expect(dismiss).toHaveBeenCalledOnce(); expect(enqueueInstruction).not.toHaveBeenCalled();
    expect(await readiness(ctx, ['apply', '9'])).toContain('Choose');
    expect(await readiness({})).toContain('unavailable');
  });
});
