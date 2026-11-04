import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLearningRuntime, type SkillLearningSettings, type SkillLearningRuntimeOptions } from '../../src/skills/SkillLearningRuntime.js';

const roots: string[] = [];
async function setup(settings: SkillLearningSettings = {}, overrides: Partial<SkillLearningRuntimeOptions> = {}) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-learning-runtime-'));
  roots.push(workspace);
  await fs.writeFile(path.join(workspace, 'check.cjs'), 'independently maintained source acceptance check');
  await fs.writeFile(path.join(workspace, 'fresh.cjs'), 'independently maintained candidate acceptance check');
  await fs.writeFile(path.join(workspace, 'output.txt'), 'before');
  const runCheck = vi.fn(async () => ({ executed: true, exitCode: 0 }));
  const extract = vi.fn(async () => ({ files: new Map([['SKILL.md', Buffer.from('---\nname: verified-work\ndescription: Reusable checked work\n---\nCheck artifacts and maintained acceptance tests.\n')]]) }));
  const options: SkillLearningRuntimeOptions = { directory: path.join(workspace, '.autohand', 'learning'),
    getSettings: () => settings, getWorkspace: () => workspace, getTaskId: () => 'task-one',
    getSource: async () => null, getLastAnswer: () => 'Changed the output and checked it.', getActivePins: () => [],
    policy: () => ({ allowed: true, automaticLearning: settings.enabled === true, provider: 'fixture-main', epoch: 'one' }),
    runCheck, extract, ...overrides };
  const runtime = await SkillLearningRuntime.create(options);
  return { workspace, runtime, runCheck, extract, options };
}
const settings = (): SkillLearningSettings => ({ enabled: true, verification: { id: 'maintained-source-v1', inputIds: ['source-fixture'],
  checks: [{ id: 'source-acceptance', command: ['node', 'check.cjs'], files: ['check.cjs'] }], artifacts: ['output.txt'] } });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.remove(root))); });

describe('SkillLearningRuntime host adapter', () => {
  it('does not turn a successful-looking response into evidence without configured independent checks', async () => {
    const { runtime, runCheck, extract } = await setup({ enabled: true });
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: false }, new AbortController().signal);
    const outcome = await runtime.latestOutcome();
    expect(outcome).toBeDefined();
    expect(runCheck).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(await runtime.coordinator.jobs()).toEqual([]);
  });

  it('uses pre-task fingerprints, actual changed artifacts, and permission-bound executed checks', async () => {
    const { runtime, workspace, runCheck, extract } = await setup(settings());
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    await fs.writeFile(path.join(workspace, 'output.txt'), 'after');
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: false }, new AbortController().signal);
    await vi.waitFor(async () => expect(await runtime.coordinator.list()).toHaveLength(1));
    expect(runCheck).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledOnce();
    expect((await runtime.coordinator.list())[0]?.status).toBe('draft');
  });

  it.each(['noop', 'changed-check', 'cancelled', 'reported-only'])('fails closed for %s evidence', async scenario => {
    const { runtime, workspace, runCheck, extract } = await setup(settings());
    if (scenario === 'reported-only') runCheck.mockResolvedValue({ executed: false, exitCode: 0 });
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    if (scenario !== 'noop') await fs.writeFile(path.join(workspace, 'output.txt'), 'after');
    if (scenario === 'changed-check') await fs.writeFile(path.join(workspace, 'check.cjs'), 'weakened by learner');
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: scenario === 'cancelled' }, new AbortController().signal);
    expect(await runtime.coordinator.jobs()).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('keeps explicit drafts available when automatic learning is off', async () => {
    const { runtime, extract } = await setup();
    await runtime.begin('Explain a reusable output validation procedure', { taskId: 'task-one', signal: new AbortController().signal });
    await runtime.finish({ instruction: 'Explain a reusable output validation procedure', success: true, aborted: false }, new AbortController().signal);
    const outcome = (await runtime.latestOutcome())!;
    await runtime.coordinator.requestDraft(outcome);
    await runtime.coordinator.processPending();
    expect(extract).toHaveBeenCalledOnce();
    expect((await runtime.coordinator.list())[0]?.status).toBe('draft');
  });

  it('does not credit a temporary change that an acceptance check restores to a no-op', async () => {
    const { runtime, workspace, runCheck } = await setup(settings());
    runCheck.mockImplementation(async () => { await fs.writeFile(path.join(workspace, 'output.txt'), 'before'); return { executed: true, exitCode: 0 }; });
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    await fs.writeFile(path.join(workspace, 'output.txt'), 'temporary after');
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: false }, new AbortController().signal);
    expect(await runtime.coordinator.jobs()).toEqual([]);
  });

  it('bounds permission-check stalls without converting a timeout into acceptance evidence', async () => {
    const configured = settings();
    configured.verification!.checks[0]!.timeoutMs = 10;
    const { runtime, workspace, runCheck } = await setup(configured);
    runCheck.mockImplementation(async () => new Promise(() => {}));
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    await fs.writeFile(path.join(workspace, 'output.txt'), 'after');
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: false }, new AbortController().signal);
    expect(await runtime.coordinator.jobs()).toEqual([]);
  });

  it('rejects weakened configured check files across restart under the same contract identity', async () => {
    const { workspace, options } = await setup(settings());
    await fs.writeFile(path.join(workspace, 'check.cjs'), 'weakened before retry');
    const restarted = await SkillLearningRuntime.create(options);
    await restarted.begin('Update output after restart', { taskId: 'task-two', signal: new AbortController().signal });
    await fs.writeFile(path.join(workspace, 'output.txt'), 'after');
    await restarted.finish({ instruction: 'Update output after restart', success: true, aborted: false }, new AbortController().signal);
    expect(await restarted.coordinator.jobs()).toEqual([]);
  });

  it('verifies candidates only through a separate fresh configured check contract', async () => {
    const configured = settings();
    configured.enabled = false;
    configured.candidateVerification = { id: 'maintained-fresh-v1', inputIds: ['fresh-fixture'], checks: [{ id: 'fresh-acceptance', command: ['node', 'fresh.cjs', '{candidate}'], files: ['fresh.cjs'] }] };
    const { runtime, runCheck } = await setup(configured);
    await runtime.begin('Update the output', { taskId: 'task-one', signal: new AbortController().signal });
    await runtime.finish({ instruction: 'Update the output', success: true, aborted: false }, new AbortController().signal);
    await runtime.coordinator.requestDraft((await runtime.latestOutcome())!);
    await runtime.coordinator.processPending();
    const candidate = (await runtime.coordinator.list())[0]!;
    await runtime.coordinator.verify(candidate.id);
    expect(runCheck).toHaveBeenCalledWith(expect.objectContaining({ command: ['node', 'fresh.cjs', candidate.packagePath] }), expect.any(AbortSignal));
    expect((await runtime.coordinator.list())[0]?.status).toBe('verified');
  });
});
