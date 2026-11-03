import { describe, expect, it, vi } from 'vitest';
import { skills, type SkillsCommandContext } from '../../src/commands/skills.js';
import type { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import type { LearnedSkillCandidate } from '../../src/skills/SkillLearningStore.js';

const candidate: LearnedSkillCandidate = { id: 'candidate-one', jobId: 'job-one', outcomeId: 'outcome-one', scope: 'project:one',
  reference: { authority: 'local', packageId: 'checks', revision: 'sha256:exact' }, parent: { authority: 'upstream', packageId: 'checks', revision: 'sha256:parent' },
  packagePath: '/managed/candidate-one/package', createdAt: '2026-11-02T00:00:00.000Z', status: 'draft' };
function context(): SkillsCommandContext {
  return { skillsRegistry: { listSkills: () => [], getActiveSkills: () => [] } as unknown as SkillsRegistry,
    isNonInteractive: true, skillLearningUserInitiated: true, skillLearningScope: 'project:one',
    getAutomaticSkillLearning: () => false, setAutomaticSkillLearning: vi.fn(async () => {}),
    getSkillLearningOutcome: vi.fn(async () => ({ id: 'outcome-one', taskId: 'task-one', scope: 'project:one', kind: 'work', evidenceRefs: ['host-check'] })),
    skillLearning: { list: vi.fn(async () => [candidate]), inspect: vi.fn(async () => candidate), requestDraft: vi.fn(async () => ({ id: 'job-one' })),
      processPending: vi.fn(async () => [{ jobId: 'job-one', state: 'published' }]), verify: vi.fn(async () => ({ ...candidate, status: 'verified' })),
      declareBenefitPlan: vi.fn(async () => ({ id: 'plan-one' })), prefer: vi.fn(async () => ({ ...candidate, status: 'preferred' })),
      rollback: vi.fn(async () => ({ ...candidate, status: 'superseded' })), exclude: vi.fn(async () => {}), deleteEvidence: vi.fn(async () => {}) } as unknown as SkillsCommandContext['skillLearning'],
  };
}

describe('/skills learning controls', () => {
  it('defaults learning off and persists only an explicit user toggle', async () => {
    const ctx = context();
    expect(await skills(ctx, ['learning', 'status'])).toContain('off');
    expect(await skills(ctx, ['learning', 'on'])).toContain('on');
    expect(ctx.setAutomaticSkillLearning).toHaveBeenCalledExactlyOnceWith(true);
    expect(await skills(ctx, ['learning', 'off'])).toContain('off');
  });

  it('never lets a model context enable learning or promote evidence', async () => {
    const ctx = { ...context(), skillLearningUserInitiated: false };
    for (const args of [['learning', 'on'], ['learn'], ['verify', candidate.id], ['prefer', candidate.id, 'plan-one']]) {
      expect(await skills(ctx, args)).toContain('user');
    }
    expect(ctx.setAutomaticSkillLearning).not.toHaveBeenCalled();
    expect(ctx.skillLearning!.verify).not.toHaveBeenCalled();
    expect(ctx.skillLearning!.prefer).not.toHaveBeenCalled();
  });

  it('queues an explicit local draft from a host outcome and does not wait for extraction', async () => {
    const ctx = context();
    vi.mocked(ctx.skillLearning!.processPending).mockImplementation(() => new Promise(() => {}));
    expect(await skills(ctx, ['learn', 'outcome-one'])).toContain('Queued');
    expect(ctx.getSkillLearningOutcome).toHaveBeenCalledWith('outcome-one');
    expect(ctx.skillLearning!.requestDraft).toHaveBeenCalledOnce();
    expect(ctx.setAutomaticSkillLearning).not.toHaveBeenCalled();
  });

  it('fails closed when no trusted prior outcome or verifier is available', async () => {
    const ctx = context();
    ctx.getSkillLearningOutcome = async () => null;
    expect(await skills(ctx, ['learn'])).toContain('No prior work outcome');
    vi.mocked(ctx.skillLearning!.verify).mockRejectedValue(new Error('No independently maintained verification contract is configured'));
    expect(await skills(ctx, ['verify', candidate.id])).toContain('independently maintained');
  });

  it('shows exact revision, upstream lineage, local package, and draft status', async () => {
    const ctx = context();
    const text = await skills(ctx, ['inspect', candidate.id]);
    expect(text).toContain('draft');
    expect(text).toContain('sha256%3Aexact');
    expect(text).toContain('sha256%3Aparent');
    expect(text).toContain(candidate.packagePath);
  });

  it('routes frozen benefit plans, exact verification and preference through independent host APIs', async () => {
    const ctx = context();
    expect(await skills(ctx, ['verify', candidate.id])).toContain('Verified');
    expect(await skills(ctx, ['benefit', candidate.id, 'plan-one'])).toContain('Predeclared');
    expect(await skills(ctx, ['prefer', candidate.id, 'plan-one'])).toContain('Preferred');
    expect(ctx.skillLearning!.verify).toHaveBeenCalledWith(candidate.id);
    expect(ctx.skillLearning!.declareBenefitPlan).toHaveBeenCalledWith(candidate.id, 'plan-one');
    expect(ctx.skillLearning!.prefer).toHaveBeenCalledWith(candidate.id, 'plan-one');
  });

  it('rolls back, excludes and forgets evidence without deleting package files', async () => {
    const ctx = context();
    expect(await skills(ctx, ['rollback', candidate.id])).toContain('Rolled back');
    expect(await skills(ctx, ['exclude', candidate.id])).toContain('Excluded');
    expect(await skills(ctx, ['forget', candidate.id])).toContain('Removed learning evidence');
    expect(ctx.skillLearning!.rollback).toHaveBeenCalledWith(candidate.id);
    expect(ctx.skillLearning!.exclude).toHaveBeenCalledWith(candidate.reference, candidate.scope);
    expect(ctx.skillLearning!.deleteEvidence).toHaveBeenCalledWith(candidate.reference, candidate.scope);
  });
});
