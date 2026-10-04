/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import { ActionExecutor } from '../../../src/core/actionExecutor.js';
import { getPlanModeManager } from '../../../src/commands/plan.js';
import { PlanFileStorage } from '../../../src/modes/planMode/PlanFileStorage.js';
import type { Plan } from '../../../src/modes/planMode/types.js';
import type { AgentRuntime } from '../../../src/types.js';

const NOTES = [
  '## Goal',
  'Refresh tokens lazily.',
  '',
  '## Steps',
  '1. Read the store',
  '   - note the callers',
  '2. Extract TokenRefresher',
  '3. Run tests',
  '',
  '## Risks',
  '- The mobile relay reads the token synchronously',
].join('\n');

const STALE_PLAN: Plan = {
  id: 'plan-stale',
  steps: [{ number: 1, description: 'Left over from another project', status: 'pending' }],
  rawText: '1. Left over from another project',
  createdAt: Date.now() - 60_000,
};

function createExecutor(overrides: { onPlanCreated?: (plan: Plan, filePath: string) => Promise<string>; onAskFollowup?: (question: string, answers?: string[]) => Promise<string> } = {}) {
  return new ActionExecutor({
    runtime: { config: { configPath: '', openrouter: { apiKey: 'test', model: 'model' } }, workspaceRoot: '/repo', options: {} } as AgentRuntime,
    files: { root: '/repo' } as FileActionManager,
    resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
    confirmDangerousAction: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

describe('plan tool', () => {
  let savePlan: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(PlanFileStorage.prototype, 'listPlans').mockResolvedValue([STALE_PLAN.id]);
    vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockResolvedValue(STALE_PLAN);
    savePlan = vi.spyOn(PlanFileStorage.prototype, 'savePlan').mockResolvedValue('/home/plans/plan-new.md');
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getPlanModeManager().enable();
  });

  afterEach(() => {
    getPlanModeManager().disable();
    vi.restoreAllMocks();
  });

  it('takes only the top-level numbered items as steps and keeps the notes verbatim', async () => {
    const onPlanCreated = vi.fn(async () => 'presented');

    const result = await createExecutor({ onPlanCreated }).execute({ type: 'plan', notes: NOTES });

    expect(result).toBe('presented');
    const [plan, filePath] = onPlanCreated.mock.calls[0] as [Plan, string];
    expect(plan.steps).toEqual([
      { number: 1, description: 'Read the store', status: 'pending' },
      { number: 2, description: 'Extract TokenRefresher', status: 'pending' },
      { number: 3, description: 'Run tests', status: 'pending' },
    ]);
    expect(plan.rawText).toBe(NOTES);
    expect(filePath).toBe('/home/plans/plan-new.md');
    expect(savePlan).toHaveBeenCalledExactlyOnceWith(plan);
  });

  it('does not interrupt planning to offer a plan that was never started', async () => {
    const onAskFollowup = vi.fn(async () => '<answer>Create new plan</answer>');
    const onPlanCreated = vi.fn(async () => 'presented');

    await createExecutor({ onPlanCreated, onAskFollowup }).execute({ type: 'plan', notes: NOTES });

    expect(onAskFollowup).not.toHaveBeenCalled();
    expect(onPlanCreated).toHaveBeenCalledOnce();
  });

  it('does not offer the plan it just wrote when the model refines it in the same session', async () => {
    const onAskFollowup = vi.fn(async () => '<answer>Create new plan</answer>');
    const onPlanCreated = vi.fn(async () => 'presented');
    const executor = createExecutor({ onPlanCreated, onAskFollowup });

    await executor.execute({ type: 'plan', notes: NOTES });
    const [firstPlan] = onPlanCreated.mock.calls[0] as [Plan, string];
    // Even if the first draft were already marked as under way, it is this session's own work.
    vi.mocked(PlanFileStorage.prototype.listPlans).mockResolvedValue([firstPlan.id]);
    vi.mocked(PlanFileStorage.prototype.loadPlan).mockResolvedValue({
      ...firstPlan,
      steps: firstPlan.steps.map((step, index) => (index === 0 ? { ...step, status: 'in_progress' } : step)),
    });
    await executor.execute({ type: 'plan', notes: '1. Read the store\n2. Extract TokenRefresher' });

    expect(onAskFollowup).not.toHaveBeenCalled();
    expect(onPlanCreated).toHaveBeenCalledTimes(2);
  });

  it('offers a plan from an earlier session that was started and left unfinished, and resumes it on request', async () => {
    const started: Plan = {
      id: 'plan-started',
      steps: [
        { number: 1, description: 'Done already', status: 'completed' },
        { number: 2, description: 'Still to do', status: 'pending' },
      ],
      rawText: '1. Done already\n2. Still to do',
      createdAt: Date.now() - 60_000,
    };
    vi.mocked(PlanFileStorage.prototype.listPlans).mockResolvedValue([STALE_PLAN.id, started.id]);
    vi.mocked(PlanFileStorage.prototype.loadPlan).mockImplementation(async (id) => (id === started.id ? started : STALE_PLAN));
    const onAskFollowup = vi.fn(async () => '<answer>Resume: plan-started</answer>');
    const onPlanCreated = vi.fn(async () => 'resumed');

    const result = await createExecutor({ onPlanCreated, onAskFollowup }).execute({ type: 'plan', notes: NOTES });

    expect(onAskFollowup).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('resume'),
      ['Create new plan', 'Resume: plan-started'],
    );
    expect(result).toBe('resumed');
    expect(onPlanCreated).toHaveBeenCalledExactlyOnceWith(started, expect.stringContaining('plan-started.md'));
    expect(savePlan).not.toHaveBeenCalled();
  });

  it('does not offer earlier plans outside plan mode', async () => {
    getPlanModeManager().disable();
    vi.mocked(PlanFileStorage.prototype.loadPlan).mockResolvedValue({
      ...STALE_PLAN,
      steps: [{ number: 1, description: 'Under way', status: 'in_progress' }],
    });
    const onAskFollowup = vi.fn(async () => '<answer>Create new plan</answer>');

    await createExecutor({ onPlanCreated: async () => 'presented', onAskFollowup }).execute({ type: 'plan', notes: NOTES });

    expect(onAskFollowup).not.toHaveBeenCalled();
  });

  it('leaves the presentation to the plan callback instead of printing its own summary', async () => {
    await createExecutor({ onPlanCreated: async () => 'presented' }).execute({ type: 'plan', notes: NOTES });

    expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain('Plan created with');
  });

  it('returns the steps itself when nothing presents the plan', async () => {
    const result = await createExecutor().execute({ type: 'plan', notes: NOTES });

    expect(result).toContain('Plan saved to /home/plans/plan-new.md');
    expect(result).toContain('1. Read the store\n2. Extract TokenRefresher\n3. Run tests');
    expect(result).not.toContain('note the callers');
  });

  it('rejects notes that contain no step at all', async () => {
    const outcome = await createExecutor().executeForTool({ type: 'plan', notes: '## Plan\n\n' }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: false, kind: 'validation' });
    expect(savePlan).not.toHaveBeenCalled();
  });
});
