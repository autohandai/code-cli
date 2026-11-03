import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGoalContinuationInstruction, GoalManager } from '../../src/goals/GoalManager.js';
import type { GoalContinuity, GoalContinuityContext } from '../../src/goals/GoalContinuity.js';
import type { SkillReference } from '../../src/skills/SkillRuntime.js';

const pin: SkillReference & { revision: string } = { authority: 'local:user', packageId: 'research', revision: 'sha256:original', resource: 'SKILL.md' };
const continuity = (): GoalContinuity => ({ version: 1, approvedIntent: 'Verify the approved artifact', workspaceId: 'repository:stable',
  skills: [pin], checkReferences: ['checks/build.log'], pendingEffects: [],
  freshness: { runtimeVersion: '1', providerId: 'autohand', permissionEpoch: 'epoch-1', capturedAt: Date.now() } });
const context = (): GoalContinuityContext => ({ workspaceId: 'repository:stable', runtimeVersion: '1', providerId: 'autohand', permissionEpoch: 'epoch-1', checkedAt: Date.now(),
  resolveSkill: async reference => ({ ...reference }) });

describe('pinned goal checkpoint continuity', () => {
  let root: string;
  let manager: GoalManager;
  let current: GoalContinuityContext;
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-continuity-'));
    current = context();
    manager = new GoalManager(root, { sessionId: 'owner', isSessionAlive: async () => false, resolveContinuityContext: async () => current });
    await manager.createGoal({ objective: 'Approved goal' });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.remove(root); });
  const save = () => manager.updateGoal({ status: 'paused', checkpoint: { summary: 'Artifact built', nextStep: 'Check current artifact', artifacts: ['artifact.bin'], continuity: continuity() } });

  it('round trips compact metadata without serializing permission grants', async () => {
    const input = { ...continuity(), grants: { write: true }, freshness: { ...continuity().freshness, grants: { execute: true } } };
    expect((await manager.updateGoal({ checkpoint: { summary: 'Saved', continuity: input } })).ok).toBe(true);
    const reloaded = new GoalManager(root, { sessionId: 'owner' });
    expect((await reloaded.getSessionSnapshot()).goal?.checkpoint?.continuity).toEqual(continuity());
    expect(await fs.readFile(path.join(root, '.autohand/goals.local.json'), 'utf8')).not.toContain('grants');
  });

  it('pauses only the recovered own goal without ownership transfer, downtime, or queue execution', async () => {
    await manager.updateGoal({ checkpoint: { summary: 'Saved', continuity: continuity() } });
    await manager.enqueueGoal({ objective: 'Still queued', source: 'command' });
    const before = await manager.getSnapshot();
    const restarted = new GoalManager(root, { sessionId: 'owner', isSessionAlive: async () => false });
    expect((await restarted.restoreSessionCheckpoint()).ok).toBe(true);
    const result = await restarted.getSnapshot();
    expect(result.goals.owner).toMatchObject({ status: 'paused', timeUsedSeconds: before.goals.owner.timeUsedSeconds, checkpoint: { summary: 'Saved', continuity: continuity() } });
    expect(result.queue).toHaveLength(1);
    expect(await restarted.getActiveGoalForSession()).toBeNull();
  });

  it('refuses startup recovery if the existing owner is live or its liveness is unknown', async () => {
    for (const isSessionAlive of [async () => true, async () => { throw new Error('unknown'); }]) {
      const restarted = new GoalManager(root, { sessionId: 'owner', isSessionAlive });
      expect((await restarted.restoreSessionCheckpoint()).ok).toBe(false);
      expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
    }
  });

  it('requires current host validation and never resolves a missing revision by alias', async () => {
    await save();
    const noHost = new GoalManager(root, { sessionId: 'owner' });
    expect((await noHost.updateGoal({ status: 'active' })).message).toContain('current context');
    current.resolveSkill = async () => ({ ...pin, revision: 'sha256:newer' });
    const rejected = await manager.updateGoal({ status: 'active' });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('sha256:original');
    expect(rejected.goal?.status).toBe('paused');
  });

  it.each(['workspaceId', 'runtimeVersion', 'providerId', 'permissionEpoch'] as const)('blocks a changed %s until explicitly revalidated', async key => {
    await save();
    current[key] = 'changed';
    const rejected = await manager.updateGoal({ status: 'active' });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain(key);
  });

  it('blocks stale checkpoints and rejects future-dated context attestation', async () => {
    const checkpoint = continuity();
    checkpoint.freshness.maxAgeMs = 100;
    checkpoint.freshness.capturedAt -= 1000;
    await manager.updateGoal({ status: 'paused', checkpoint: { summary: 'Old', continuity: checkpoint } });
    expect((await manager.updateGoal({ status: 'active' })).message).toContain('stale');
    current.checkedAt = Date.now() + 60_000;
    expect((await manager.updateGoal({ status: 'active' })).ok).toBe(false);
  });

  it('observes an unknown external effect before allowing continuation and persists the observation', async () => {
    const checkpoint = continuity();
    checkpoint.pendingEffects = [{ id: 'publish', description: 'Publication may have reached the service', status: 'unknown' }];
    await manager.updateGoal({ status: 'paused', checkpoint: { summary: 'Interrupted publication', continuity: checkpoint } });
    expect((await manager.updateGoal({ status: 'active' })).message).toContain('observe');
    current.observeEffect = async () => ({ status: 'unknown', evidence: 'Service unavailable', observedAt: Date.now() });
    expect((await manager.updateGoal({ status: 'active' })).ok).toBe(false);
    const observer = vi.fn(async () => ({ status: 'completed' as const, evidence: 'receipt:123', observedAt: Date.now() }));
    current.observeEffect = observer;
    const resumed = await manager.updateGoal({ status: 'active' });
    expect(resumed.ok).toBe(true);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(resumed.goal?.checkpoint?.continuity?.pendingEffects[0]).toMatchObject({ status: 'observed', observation: { status: 'completed', evidence: 'receipt:123' } });
    expect(resumed.goal?.checkpointHistory?.at(-1)?.continuity?.pendingEffects[0].status).toBe('unknown');
  });

  it('preserves unknown effects across ordinary checkpoint replacements', async () => {
    const checkpoint = continuity(); checkpoint.pendingEffects = [{ id: 'publish', description: 'Unknown effect', status: 'unknown' }];
    await manager.updateGoal({ status: 'paused', checkpoint: { summary: 'Interrupted', continuity: checkpoint } });
    expect((await manager.updateGoal({ checkpoint: { summary: 'Hide uncertainty', continuity: continuity() } })).ok).toBe(false);
  });

  it('normalizes an omitted resource to the exact SKILL.md entrypoint', async () => {
    const saved = continuity(); saved.skills = [{ authority: pin.authority, packageId: pin.packageId, revision: pin.revision }];
    await manager.updateGoal({ status: 'paused', checkpoint: { summary: 'Saved package pin', continuity: saved } });
    current.resolveSkill = async reference => ({ ...reference, resource: 'SKILL.md' });
    expect((await manager.updateGoal({ status: 'active' })).ok).toBe(true);
  });

  it('requires an explicit pin upgrade and retains the original checkpoint as historical evidence', async () => {
    await save();
    const upgraded = { ...pin, revision: 'sha256:reviewed-replacement' };
    const updated = await manager.upgradeSkillPins([upgraded]);
    expect(updated.ok).toBe(true);
    expect(updated.goal?.status).toBe('paused');
    expect(updated.goal?.checkpoint?.continuity?.skills).toEqual([upgraded]);
    expect(updated.goal?.checkpointHistory?.at(-1)?.continuity?.skills).toEqual([pin]);
    const reloaded = new GoalManager(root, { sessionId: 'owner' });
    expect((await reloaded.getSessionSnapshot()).goal?.checkpointHistory?.at(-1)?.continuity?.skills).toEqual([pin]);
  });

  it('retains pins when an older caller replaces only the progress summary', async () => {
    await save();
    expect((await manager.updateGoal({ checkpoint: { summary: 'Current verification pending' } })).ok).toBe(true);
    expect((await manager.getSessionSnapshot()).goal?.checkpoint?.continuity?.skills).toEqual([pin]);
    expect((await manager.getSessionSnapshot()).goal?.checkpointHistory).toBeUndefined();
  });

  it('carries compact checkpoint intent and observed effects into a continuation instruction', () => {
    const saved = continuity();
    saved.pendingEffects = [{ id: 'publish', description: 'Publication', status: 'observed', observation: { status: 'completed', evidence: 'receipt:123', observedAt: Date.now() } }];
    const instruction = buildGoalContinuationInstruction('Approved goal', { summary: 'Built artifact', nextStep: 'Verify it', recordedAt: Date.now(), continuity: saved });
    expect(instruction).toContain('Verify the approved artifact');
    expect(instruction).toContain('Verify it');
    expect(instruction).toContain('sha256:original');
    expect(instruction).toContain('receipt:123');
    expect(instruction).toContain('Do not repeat');
  });

  it('retains exact historical checkpoints when completion advances the shared queue', async () => {
    await save();
    await manager.upgradeSkillPins([{ ...pin, revision: 'sha256:replacement' }]);
    await manager.enqueueGoal({ objective: 'Next approved goal', source: 'command' });
    const completed = await manager.updateGoal({ status: 'complete', completionEvidence: { summary: 'Artifact independently verified', checks: [{ criterion: 'Artifact verified', status: 'passed', evidence: 'receipt:verification' }] } });
    expect(completed.ok).toBe(true);
    expect(completed.goal?.objective).toBe('Next approved goal');
    const snapshot = await manager.getSnapshot();
    expect(snapshot.completed[0].checkpoint?.continuity?.skills[0].revision).toBe('sha256:replacement');
    expect(snapshot.completed[0].checkpointHistory?.[0].continuity?.skills).toEqual([pin]);
  });

  it('captures actual submitted pins through the host when saving an ordinary checkpoint', async () => {
    const capturing = new GoalManager(root, { sessionId: 'owner', resolveContinuityContext: async () => current, getPinnedReferences: () => [pin] });
    const result = await capturing.updateGoal({ checkpoint: { summary: 'Observed submitted skill work' } });
    expect(result.ok).toBe(true);
    expect(result.goal?.checkpoint?.continuity).toMatchObject({ approvedIntent: 'Approved goal', workspaceId: 'repository:stable', skills: [pin], freshness: { providerId: 'autohand' } });
    const conflicting = new GoalManager(root, { sessionId: 'owner', resolveContinuityContext: async () => current, getPinnedReferences: () => [{ ...pin, revision: 'sha256:changed' }] });
    expect((await conflicting.updateGoal({ checkpoint: { summary: 'Must not replace existing pins' } })).message).toContain('explicit');
    expect((await manager.getSessionSnapshot()).goal?.checkpoint?.continuity?.skills).toEqual([pin]);
  });

  it('permits an explicit pin upgrade while retaining historical submitted references', async () => {
    const capturing = new GoalManager(root, { sessionId: 'owner', resolveContinuityContext: async () => current, getPinnedReferences: () => [pin] });
    await capturing.updateGoal({ status: 'paused', checkpoint: { summary: 'Original submitted procedure' } });
    const replacement = { ...pin, revision: 'sha256:explicit-upgrade' };
    const upgraded = await capturing.upgradeSkillPins([replacement]);
    expect(upgraded.ok).toBe(true);
    expect(upgraded.goal?.checkpoint?.continuity?.skills).toEqual([replacement]);
    expect(upgraded.goal?.checkpointHistory?.at(-1)?.continuity?.skills).toEqual([pin]);
  });

  it('continues reading old version-one snapshots without manufacturing continuity', async () => {
    const before = await manager.getSnapshot();
    await fs.writeJson(path.join(root, '.autohand/goals.local.json'), { version: 1, goal: before.goals.owner, activeSessionId: 'owner' });
    const result = await manager.getSessionSnapshot();
    expect(result.version).toBe(2);
    expect(result.goal?.checkpoint?.continuity).toBeUndefined();
  });
});
