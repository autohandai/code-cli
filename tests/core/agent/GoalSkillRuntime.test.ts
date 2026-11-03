import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoalSkillRuntime } from '../../../src/core/agent/GoalSkillRuntime.js';
import { SkillsRegistry } from '../../../src/skills/SkillsRegistry.js';
import { GoalManager } from '../../../src/goals/GoalManager.js';
import type { GoalStatus } from '../../../src/goals/types.js';
import type { ExactSkillReference } from '../../../src/skills/SkillRevisionStore.js';

describe('live goal skill runtime adapter', () => {
  let root: string;
  let registry: SkillsRegistry;
  let manager: GoalManager;
  let provider: string;
  let permissionEpoch: string;
  let runtime: { workspaceRoot: string; config: { configPath: string; features: { adaptiveSkills: boolean } } };
  let adapter: ReturnType<typeof createGoalSkillRuntime>;
  let reference: ExactSkillReference;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-skill-runtime-'));
    for (const name of ['checks', 'keep-user']) await fs.outputFile(path.join(root, 'user', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} independent procedure\n---\nOriginal required ${name} instructions.`);
    runtime = { workspaceRoot: root, config: { configPath: path.join(root, 'config.json'), features: { adaptiveSkills: true } } };
    registry = new SkillsRegistry(path.join(root, 'user'), 'autohand-user', { builtinSkillDirectories: [], embeddedBuiltinAssetsRoot: path.join(root, 'embedded'), adaptiveEnabled: () => runtime.config.features.adaptiveSkills });
    await registry.initialize(); await registry.setWorkspace(root);
    provider = 'openrouter'; permissionEpoch = 'approved';
    manager = new GoalManager(root, { sessionId: 'owner', isSessionAlive: async () => false });
    reference = (await registry.getSkillRuntime().prepare('checks', { taskId: 'fixture', reason: 'explicit', maxTokens: 10_000 })).reference;
    adapter = createGoalSkillRuntime({ runtime, getRegistry: () => registry, getSessionId: () => 'owner', getActiveProvider: () => provider, getPermissionEpoch: () => permissionEpoch, runtimeVersion: 'fixture' });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.remove(root); });
  async function saveGoal(status: GoalStatus = 'active') {
    const created = await manager.createGoal({ objective: 'Approved checks' });
    if (!created.goal) throw new Error('Missing goal fixture');
    const context = await adapter.resolveContext(created.goal);
    await manager.updateGoal({ status, checkpoint: { summary: 'Prepared artifact', continuity: { version: 1, approvedIntent: 'Approved checks', workspaceId: context.workspaceId,
      skills: [reference], checkReferences: [], pendingEffects: [], freshness: { runtimeVersion: context.runtimeVersion, providerId: context.providerId, permissionEpoch: context.permissionEpoch, capturedAt: context.checkedAt } } } });
  }

  it('reads current context without manufacturing a missing workspace identity', async () => {
    await fs.remove(path.join(root, '.autohand/workspace-identity.json'));
    const created = await manager.createGoal({ objective: 'Saved objective' });
    await expect(adapter.resolveContext(created.goal!)).rejects.toThrow('workspace identity');
    expect(await fs.pathExists(path.join(root, '.autohand/workspace-identity.json'))).toBe(false);
  });

  it('restores the exact archived revision only for an active approved goal', async () => {
    await saveGoal();
    await fs.writeFile(path.join(root, 'user/checks/SKILL.md'), 'Changed live instructions');
    await adapter.prepareTurnContext?.();
    const session = registry.getAdaptiveSession(); await session.beginTask('Continue approved checks', { automatic: false });
    const packets = await session.prepareRequest({ maxTokens: 10_000 });
    expect(packets).toHaveLength(1); expect(packets[0].reference.revision).toBe(reference.revision);
    expect(packets[0].content).toContain('Original required checks instructions.');
    expect(packets[0].content).not.toContain('Changed live instructions');
  });

  it('does not load or activate paused goal dependencies', async () => {
    await saveGoal('paused');
    const prepare = vi.spyOn(registry.getSkillRuntime(), 'prepare'); const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins');
    await adapter.prepareTurnContext?.();
    expect(prepare).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); expect(registry.getActiveSkills()).toEqual([]);
  });

  it('keeps legacy and feature-off sessions unchanged', async () => {
    await manager.createGoal({ objective: 'Legacy approved goal' }); runtime.config.features.adaptiveSkills = false;
    const prepare = vi.spyOn(registry.getSkillRuntime(), 'prepare'); const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins');
    await adapter.prepareTurnContext?.(); expect(prepare).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    const context = await adapter.resolveContext((await manager.getSessionSnapshot()).goal!);
    expect(await context.resolveSkill(reference)).toBeNull(); expect(prepare).not.toHaveBeenCalled();
  });

  it('rechecks actual provider and permission context before restoring packets', async () => {
    await saveGoal(); const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins'); provider = 'changed';
    await expect(adapter.prepareTurnContext?.()).rejects.toThrow('providerId changed'); expect(restore).not.toHaveBeenCalled();
    provider = 'openrouter'; permissionEpoch = 'changed';
    await expect(adapter.prepareTurnContext?.()).rejects.toThrow('permissionEpoch changed'); expect(restore).not.toHaveBeenCalled();
  });

  it('rejects a permission epoch that changes while exact revision validation is awaiting I/O', async () => {
    await saveGoal();
    const original = registry.getSkillRuntime().prepare.bind(registry.getSkillRuntime());
    vi.spyOn(registry.getSkillRuntime(), 'prepare').mockImplementation(async (...args) => { permissionEpoch = 'revoked-during-read'; return original(...args); });
    const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins');
    await expect(adapter.prepareTurnContext?.()).rejects.toThrow('permissionEpoch changed');
    expect(restore).not.toHaveBeenCalled();
  });

  it('blocks missing exact archives without substituting the current package revision', async () => {
    await saveGoal(); await fs.remove(path.join(root, 'user/.revisions')); await fs.writeFile(path.join(root, 'user/checks/SKILL.md'), 'Unapproved replacement');
    const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins');
    await expect(adapter.prepareTurnContext?.()).rejects.toThrow(reference.revision);
    expect(restore).not.toHaveBeenCalled();
  });

  it('keeps unknown external effects blocked until a real observation is available', async () => {
    await saveGoal(); const saved = (await manager.getSessionSnapshot()).goal!;
    await manager.updateGoal({ checkpoint: { ...saved.checkpoint!, continuity: { ...saved.checkpoint!.continuity!, pendingEffects: [{ id: 'publish', description: 'Uncertain publication', status: 'unknown' }] } } });
    const restore = vi.spyOn(registry.getAdaptiveSession(), 'restorePins');
    await expect(adapter.prepareTurnContext?.()).rejects.toThrow('remains uncertain'); expect(restore).not.toHaveBeenCalled();
  });

  it('returns only pins from actual submitted requests in the current task and session', async () => {
    const session = registry.getAdaptiveSession(); await session.beginTask('$checks', { automatic: false, taskId: 'task-1' });
    expect(adapter.getPinnedReferences()).toEqual([]);
    const packets = await session.prepareRequest({ maxTokens: 10_000 }); expect(adapter.getPinnedReferences()).toEqual([]);
    await session.acknowledgeRequest(packets, { requestId: 'request-1', sessionId: 'owner', content: packets.map(packet => packet.content), policyEpoch: 1 });
    expect(adapter.getPinnedReferences()).toHaveLength(1);
    await session.beginTask('Continue', { automatic: false, taskId: 'task-2' }); expect(adapter.getPinnedReferences()).toEqual([]);
  });

  it('requires every active goal pin at each request and rejects missing or changed revisions', async () => {
    await saveGoal();
    await expect(adapter.assertTaskPins?.([reference])).resolves.toBeUndefined();
    await expect(adapter.assertTaskPins?.([])).rejects.toThrow('required pinned skill');
    await expect(adapter.assertTaskPins?.([{ ...reference, revision: `sha256:${'a'.repeat(64)}` }])).rejects.toThrow('required pinned skill');
    await expect(adapter.assertTaskPins?.([reference, { ...reference, packageId: 'newly-needed', revision: `sha256:${'b'.repeat(64)}` }])).resolves.toBeUndefined();
    await expect(adapter.assertTaskPins?.([reference, { ...reference, resource: 'checks/new.md', revision: `sha256:${'c'.repeat(64)}` }])).rejects.toThrow('required pinned skill');
    await expect(adapter.assertTaskPins?.([reference, { ...reference, resource: 'checks/extra.md' }])).resolves.toBeUndefined();
    provider = 'changed'; await expect(adapter.assertTaskPins?.([reference])).rejects.toThrow('providerId changed');
    provider = 'openrouter'; permissionEpoch = 'changed'; await expect(adapter.assertTaskPins?.([reference])).rejects.toThrow('permissionEpoch changed');
  });

  it('accepts an explicitly upgraded checkpoint pin and leaves stopped goals unconstrained', async () => {
    await saveGoal(); await manager.updateGoal({ status: 'paused' });
    await expect(adapter.assertTaskPins?.([])).resolves.toBeUndefined();
    await fs.writeFile(path.join(root, 'user/checks/SKILL.md'), 'Explicitly reviewed replacement instructions');
    const replacement = (await registry.getSkillRuntime().prepare('checks', { taskId: 'upgrade', reason: 'explicit', maxTokens: 10_000 })).reference;
    expect((await manager.upgradeSkillPins([replacement])).ok).toBe(true);
    const resumed = new GoalManager(root, { sessionId: 'owner', resolveContinuityContext: adapter.resolveContext });
    expect((await resumed.updateGoal({ status: 'active' })).ok).toBe(true);
    await expect(adapter.assertTaskPins?.([replacement])).resolves.toBeUndefined();
    await expect(adapter.assertTaskPins?.([reference])).rejects.toThrow('required pinned skill');
  });

  it('clears goal-only automatic activations after completion while preserving explicit user selections', async () => {
    registry.activateSkill('keep-user', 'user'); await saveGoal(); await adapter.prepareTurnContext?.();
    const session = registry.getAdaptiveSession(); await session.beginTask('Continue approved checks', { automatic: false }); await session.prepareRequest({ maxTokens: 10_000 });
    expect(registry.getSkill('checks')?.isActive).toBe(true);
    await manager.updateGoal({ status: 'complete' }); await adapter.prepareTurnContext?.();
    expect(registry.getSkill('checks')?.isActive).toBe(false); expect(registry.getSkill('keep-user')?.isActive).toBe(true);
    await session.beginTask('hello', { automatic: false }); expect((await session.prepareRequest({ maxTokens: 10_000 })).map(packet => packet.name)).toEqual(['keep-user']);
  });
});
