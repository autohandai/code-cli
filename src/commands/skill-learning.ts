import type { SkillLearningCoordinator } from '../skills/SkillLearningCoordinator.js';
import type { LearnedSkillCandidate, SkillOutcomeInput } from '../skills/SkillLearningStore.js';
import { formatSkillReference } from '../skills/SkillRuntime.js';

export interface SkillLearningCommandContext {
  skillLearning?: Pick<SkillLearningCoordinator, 'list' | 'jobs' | 'inspect' | 'requestDraft' | 'processPending' | 'verify' | 'declareBenefitPlan' | 'prefer' | 'rollback' | 'exclude' | 'deleteEvidence'>;
  skillLearningScope?: string;
  skillLearningUserInitiated?: boolean;
  getAutomaticSkillLearning?: () => boolean;
  setAutomaticSkillLearning?: (enabled: boolean) => Promise<void>;
  getSkillLearningOutcome?: (outcomeId?: string) => Promise<SkillOutcomeInput | null>;
  onSkillLearningChanged?: () => Promise<void> | void;
}

const USAGE = 'Usage: /skills learning [on|off|status|list], learn [outcome-id], inspect <candidate>, verify <candidate>, benefit <candidate> <plan>, prefer <candidate> <plan>, rollback <candidate>, exclude <candidate>, forget <candidate>';

function describe(candidate: LearnedSkillCandidate): string {
  return [`${candidate.id} · ${candidate.status} · ${candidate.scope}`,
    `Revision: ${formatSkillReference(candidate.reference)}`,
    ...(candidate.parent ? [`Parent: ${formatSkillReference(candidate.parent)}`] : []),
    `Package: ${candidate.packagePath}`,
    `Source outcome: ${candidate.outcomeId}`,
  ].join('\n');
}

export async function skillLearningCommand(ctx: SkillLearningCommandContext, args: string[]): Promise<string> {
  const command = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  const readOnly = (command === 'learning' && (!action || action === 'status' || action === 'list')) || command === 'inspect';
  if (!readOnly && ctx.skillLearningUserInitiated !== true) return 'Skill learning changes require an explicit user command.';
  try {
    if (command === 'learning') {
      if (!action || action === 'status') {
        return `Automatic skill learning: ${ctx.getAutomaticSkillLearning?.() === true ? 'on' : 'off'}.\nExplicit drafts: /skills learn [outcome-id]\nInspect drafts and jobs: /skills learning list`;
      }
      if (action === 'on' || action === 'off') {
        if (!ctx.setAutomaticSkillLearning) return 'Automatic learning settings are unavailable in this session.';
        await ctx.setAutomaticSkillLearning(action === 'on');
        return `Automatic skill learning: ${action}.`;
      }
      if (action !== 'list') return USAGE;
    }
    const coordinator = ctx.skillLearning;
    if (!coordinator) return 'Skill learning runtime is not available in this session.';
    if (command === 'learning' && action === 'list') {
      const candidates = await coordinator.list(ctx.skillLearningScope);
      const jobs = await coordinator.jobs?.(ctx.skillLearningScope) ?? [];
      return [...(candidates.length ? candidates.map(describe) : ['No learned drafts yet.']),
        ...jobs.slice(-10).map(job => `Job ${job.id} · ${job.state}${job.error ? ` · ${job.error}` : ''}`)].join('\n\n');
    }
    if (command === 'learn') {
      if (args.length > 2) return 'Usage: /skills learn [outcome-id]';
      const outcome = await ctx.getSkillLearningOutcome?.(args[1]);
      if (!outcome) return 'No prior work outcome is available for a draft. Complete a work task or create a skill with /skills new.';
      if (ctx.skillLearningScope && outcome.scope !== ctx.skillLearningScope) return 'The source outcome is outside the current learning scope.';
      const job = await coordinator.requestDraft(outcome);
      if (!job) return 'This outcome does not qualify for a learning draft.';
      void Promise.resolve().then(() => coordinator.processPending(1)).then(() => ctx.onSkillLearningChanged?.()).catch(() => {});
      return `Queued draft learning job: ${job.id}\nInspect progress: /skills learning list`;
    }
    const id = args[1];
    if (!id) return USAGE;
    const candidate = (await coordinator.list(ctx.skillLearningScope)).find(value => value.id === id);
    if (!candidate) return `Learned skill candidate not found in the current scope: ${id}`;
    if (command === 'inspect') return describe(candidate);
    let message: string;
    if (command === 'verify') {
      const verified = await coordinator.verify(id);
      message = `Verified ${id} for ${verified.scope}.\nRevision: ${formatSkillReference(verified.reference)}`;
    } else if (command === 'benefit') {
      if (!args[2] || args.length !== 3) return 'Usage: /skills benefit <candidate> <plan-id>';
      const plan = await coordinator.declareBenefitPlan(id, args[2]);
      message = `Predeclared benefit plan: ${plan.id}\nEvaluate it with /skills prefer ${id} ${plan.id}`;
    } else if (command === 'prefer') {
      if (!args[2] || args.length !== 3) return 'Usage: /skills prefer <candidate> <plan-id>';
      const preferred = await coordinator.prefer(id, args[2]);
      message = `Preferred ${id} for ${preferred.scope}.\nRevision: ${formatSkillReference(preferred.reference)}`;
    } else if (command === 'rollback') {
      await coordinator.rollback(id);
      message = `Rolled back ${id}. Its package and upstream revision remain available.`;
    } else if (command === 'exclude') {
      await coordinator.exclude(candidate.reference, candidate.scope);
      message = `Excluded ${id} from future learning and preference.`;
    } else if (command === 'forget') {
      await coordinator.deleteEvidence(candidate.reference, candidate.scope);
      message = `Removed learning evidence and queued jobs for ${id}. Package files remain available.`;
    } else return USAGE;
    await ctx.onSkillLearningChanged?.();
    return message;
  } catch (error) {
    return `Skill learning: ${error instanceof Error ? error.message : 'The operation could not be completed.'}`;
  }
}
