import { createHash } from 'node:crypto';
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import { GoalManager } from '../../goals/GoalManager.js';
import { preflightGoalContinuity, type GoalContinuity, type GoalContinuityContext, type GoalRuntimeContinuity } from '../../goals/GoalContinuity.js';
import type { GoalState } from '../../goals/types.js';
import { isAdaptiveSkillsEnabled } from '../../skills/feature.js';
import { readSkillWorkspaceIdentity } from '../../skills/workspaceIdentity.js';
import { formatSkillReference, type SkillReference } from '../../skills/SkillRuntime.js';
import type { SkillsRegistry } from '../../skills/SkillsRegistry.js';
import type { AgentRuntime } from '../../types.js';

type GoalSkillRegistry = Pick<SkillsRegistry, 'getSkillRuntime' | 'getAdaptiveSession' | 'getActiveSkills' | 'getSkillReference' | 'getActivationOrigin' | 'deactivateSkill'>;
export interface GoalSkillRuntimeOptions {
  runtime: Pick<AgentRuntime, 'workspaceRoot' | 'config'>;
  getActiveProvider(): string;
  getPermissionEpoch(): string;
  getRegistry(): GoalSkillRegistry | undefined;
  getSessionId(): string | undefined;
  runtimeVersion: string;
}

export function createGoalSkillRuntime(options: GoalSkillRuntimeOptions): GoalRuntimeContinuity {
  let boundGoal: string | undefined;
  let boundRegistry: GoalSkillRegistry | undefined;
  const clearSelections = (registry: GoalSkillRegistry): void => {
    for (const skill of registry.getActiveSkills()) {
      if (registry.getActivationOrigin(skill) === 'agent') registry.deactivateSkill(formatSkillReference(registry.getSkillReference(skill)));
    }
    registry.getAdaptiveSession().reset();
  };
  const releaseGoal = (): void => {
    if (boundRegistry) clearSelections(boundRegistry);
    boundRegistry = undefined; boundGoal = undefined;
  };
  const resolveContext = async (): Promise<GoalContinuityContext> => {
    const workspaceId = await readSkillWorkspaceIdentity(options.runtime.workspaceRoot);
    if (!workspaceId) throw new TypeError('Cannot resume: workspace identity is missing. Restore the existing workspace identity before continuing; no identity was created.');
    const providerId = options.getActiveProvider();
    const permissionEpoch = options.getPermissionEpoch();
    if (!providerId || !permissionEpoch) throw new TypeError('Cannot resume: current provider or permission context is unavailable.');
    return { workspaceId, runtimeVersion: options.runtimeVersion, providerId, permissionEpoch, checkedAt: Date.now(),
      resolveSkill: async reference => {
        if (!isAdaptiveSkillsEnabled(options.runtime.config)) return null;
        const registry = options.getRegistry(); if (!registry) return null;
        try {
          const packet = await registry.getSkillRuntime().prepare(reference, {
            taskId: 'goal-preflight', reason: 'restored', maxTokens: Number.MAX_SAFE_INTEGER, allowArchived: true,
          });
          return packet.reference;
        } catch { return null; }
      },
      observeEffect: async () => ({ status: 'unknown', evidence: 'No current external-effect observation is available from this runtime.', observedAt: Date.now() }),
    };
  };
  const validateGoal = async (goal: GoalState, continuity: GoalContinuity, manager: GoalManager, sessionId: string, workspaceRoot: string): Promise<void> => {
    await preflightGoalContinuity(goal, resolveContext);
    const latest = (await manager.getSnapshot()).goals[sessionId];
    if (options.runtime.workspaceRoot !== workspaceRoot) throw new TypeError('Cannot use goal pins: workspace changed during context validation.');
    if (options.getActiveProvider() !== continuity.freshness.providerId) throw new TypeError('Cannot use goal pins: providerId changed during context validation.');
    if (options.getPermissionEpoch() !== continuity.freshness.permissionEpoch) throw new TypeError('Cannot use goal pins: permissionEpoch changed during context validation.');
    if (!latest || latest.status !== 'active' || latest.goalId !== goal.goalId || JSON.stringify(latest.checkpoint) !== JSON.stringify(goal.checkpoint)) {
      throw new TypeError('The goal changed during skill context validation. Review its current state before continuing.');
    }
    if (continuity.skills.length && !isAdaptiveSkillsEnabled(options.runtime.config)) throw new TypeError('Cannot use required goal pins: adaptive skills are disabled.');
  };
  return {
    resolveContext,
    getPinnedReferences: () => {
      if (!isAdaptiveSkillsEnabled(options.runtime.config)) return [];
      const registry = options.getRegistry(); if (!registry) return [];
      const session = registry.getAdaptiveSession(); const taskId = session.getTaskId(); const sessionId = options.getSessionId();
      if (!taskId || !sessionId) return [];
      const submitted = new Set(registry.getSkillRuntime().receipts()
        .filter(receipt => receipt.state === 'submitted' && receipt.taskId === taskId && receipt.sessionId === sessionId)
        .map(receipt => referenceKey(receipt.reference)));
      return session.getPinnedReferences().filter(reference => submitted.has(referenceKey(reference)))
        .map(reference => ({ ...reference, resource: reference.resource ?? 'SKILL.md' }));
    },
    assertTaskPins: async references => {
      const sessionId = options.getSessionId(); if (!sessionId) return;
      const workspaceRoot = options.runtime.workspaceRoot;
      const manager = new GoalManager(workspaceRoot, { sessionId });
      const goal = (await manager.getSnapshot()).goals[sessionId];
      if (!goal || goal.status !== 'active' || !goal.checkpoint?.continuity) return;
      const continuity = goal.checkpoint.continuity;
      await validateGoal(goal, continuity, manager, sessionId, workspaceRoot);
      for (const required of continuity.skills) {
        const samePackage = references.filter(reference => reference.authority === required.authority && reference.packageId === required.packageId);
        const matching = samePackage.filter(reference => (reference.resource ?? 'SKILL.md') === (required.resource ?? 'SKILL.md'));
        if (!matching.length || samePackage.some(reference => reference.revision !== required.revision)) {
          throw new TypeError(`Cannot dispatch: required pinned skill ${formatSkillReference(required)} is missing or changed. Choose an explicit goal skill upgrade before replacing it.`);
        }
      }
    },
    prepareTurnContext: async () => {
      const sessionId = options.getSessionId();
      if (!sessionId) { releaseGoal(); return; }
      const workspaceRoot = options.runtime.workspaceRoot;
      const manager = new GoalManager(workspaceRoot, { sessionId });
      const goal = (await manager.getSnapshot()).goals[sessionId];
      if (!goal || goal.status !== 'active' || !goal.checkpoint?.continuity) { releaseGoal(); return; }
      await validateGoal(goal, goal.checkpoint.continuity, manager, sessionId, workspaceRoot);
      const pins = goal.checkpoint.continuity.skills;
      if (!pins.length) { releaseGoal(); return; }
      const registry = options.getRegistry();
      if (!registry) throw new TypeError('Cannot restore goal skill pins: the skill registry is unavailable.');
      const identity = `${options.runtime.workspaceRoot}\0${sessionId}\0${goal.goalId}\0${JSON.stringify(pins)}`;
      if (boundGoal === identity && boundRegistry === registry) return;
      releaseGoal(); clearSelections(registry);
      registry.getAdaptiveSession().restorePins(pins);
      boundRegistry = registry; boundGoal = identity;
    },
  };
}

function referenceKey(reference: SkillReference): string {
  return formatSkillReference({ ...reference, resource: reference.resource ?? 'SKILL.md' });
}

export function createGoalPermissionEpoch(runtime: Pick<AgentRuntime, 'config' | 'options'>,
  permissions: Pick<PermissionManager, 'getMode' | 'getEffectiveSettings' | 'getPermissionSnapshot' | 'getRunToolScope' | 'isReadOnlyReview'>): string {
  const options = runtime.options;
  const snapshot = permissions.getPermissionSnapshot(runtime.config.configPath);
  const policy = { version: 1, mode: permissions.getMode(), settings: permissions.getEffectiveSettings(), effectiveLists: snapshot.effective,
    readOnlyReview: permissions.isReadOnlyReview(), toolScope: permissions.getRunToolScope(), workspaceTrust: runtime.config.workspaceTrust,
    run: { yes: options.yes === true, dryRun: options.dryRun === true, restricted: options.restricted === true, unrestricted: options.unrestricted === true,
      yolo: options.yolo ?? null, allowedTools: [...(options.allowedTools ?? [])].sort(), disallowedTools: [...(options.disallowedTools ?? [])].sort(),
      addDir: [...(options.addDir ?? [])].sort(), answerOnly: options.answerOnly === true, setupOnly: options.setupOnly === true,
      clientContext: options.clientContext ?? 'cli', plan: options.plan === true } };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalPolicy(policy))).digest('hex')}`;
}

function canonicalPolicy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPolicy);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => [name, canonicalPolicy(item)]));
}
