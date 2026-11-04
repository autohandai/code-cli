import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentSkillLearning, type AgentSkillLearningOptions } from '../../../src/core/agent/AgentSkillLearning.js';
import { SkillLearningRuntime } from '../../../src/skills/SkillLearningRuntime.js';
import { skills } from '../../../src/commands/skills.js';
import type { AgentRuntime, ProviderName } from '../../../src/types.js';
import type { SkillsRegistry } from '../../../src/skills/SkillsRegistry.js';
import { SkillRevisionStore, computeSkillRevision, createSkillRevisionManifest } from '../../../src/skills/SkillRevisionStore.js';

const roots: string[] = [];
async function setup() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skill-learning-'));
  roots.push(workspace);
  const runtime: AgentRuntime = { config: { configPath: path.join(workspace, 'config.json'), provider: 'custom:fixture',
    customProviders: { fixture: { id: 'fixture', displayName: 'Fixture', apiFormat: 'openai-compatible', apiKeyRequired: false, model: 'fixture', baseUrl: 'http://127.0.0.1:9', backgroundCalls: false } },
    features: { adaptiveSkills: false } }, workspaceRoot: workspace, options: {} };
  const complete = vi.fn(async () => ({ id: 'fixture', created: Date.now(), content: JSON.stringify({ skillMarkdown: '---\nname: checked-work\ndescription: Reusable output checks\n---\nCheck the observable output.\n' }) }));
  const llm = { complete };
  const registry = { getUserSkillsDir: () => path.join(workspace, 'user-skills'), getAdaptiveSession: () => ({ getPinnedReferences: () => [] }),
    getSkillRuntime: () => ({ resolve: () => null }), ensureAdaptiveWorkspace: vi.fn(async () => {}), setLearnedCandidates: vi.fn(async () => {}) };
  let userCommand = true;
  let provider: ProviderName | null = 'custom:fixture';
  const persistSettings = vi.fn(async () => {});
  const options: AgentSkillLearningOptions = { runtime, registry, getActiveProvider: () => provider, getLLM: () => llm,
    getPermissionManager: () => undefined, getPolicyEpoch: () => 1, getLastAnswer: () => 'Validated the output.', persistSettings, isUserCommand: () => userCommand };
  return { runtime, options, complete, registry, persistSettings, bridge: createAgentSkillLearning(options), setUser: (value: boolean) => { userCommand = value; }, setProvider: (value: ProviderName | null) => { provider = value; } };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.remove(root))); });

describe('live agent skill learning bridge', () => {
  it('does no constructor or disabled-turn IO and always assigns fresh task identity', async () => {
    const create = vi.spyOn(SkillLearningRuntime, 'create');
    const { bridge, runtime } = await setup();
    expect(create).not.toHaveBeenCalled();
    await bridge.beginSkillLearningTurn('hello', new AbortController().signal);
    const first = runtime.skillTaskId;
    await bridge.finishSkillLearningTurn({ instruction: 'hello', success: true, aborted: false }, new AbortController().signal);
    await bridge.beginSkillLearningTurn('another task', new AbortController().signal);
    expect(runtime.skillTaskId).not.toBe(first);
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the active main provider only for an explicit draft and supplies no tools or conversation history', async () => {
    const { bridge, runtime, complete, registry } = await setup();
    runtime.config.features!.adaptiveSkills = true;
    const signal = new AbortController().signal;
    await bridge.beginSkillLearningTurn('Validate an output artifact', signal);
    await bridge.finishSkillLearningTurn({ instruction: 'Validate an output artifact', success: true, aborted: false }, signal);
    expect(complete).not.toHaveBeenCalled();
    const ctx = await bridge.getCommandContext();
    const outcome = (await ctx.getSkillLearningOutcome!())!;
    await ctx.skillLearning!.requestDraft(outcome);
    await ctx.skillLearning!.processPending();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ tools: [], toolChoice: 'none', maxTokens: 2_048, stream: false });
    expect(complete.mock.calls[0]?.[0].messages).toHaveLength(2);
    expect((await ctx.skillLearning!.list())[0]?.status).toBe('draft');
    await ctx.onSkillLearningChanged!();
    expect(registry.setLearnedCandidates).toHaveBeenCalled();
  });

  it('rechecks user origin at invocation before persisting an opt-in', async () => {
    const { bridge, setUser, persistSettings, registry } = await setup();
    const ctx = await bridge.getCommandContext();
    setUser(false);
    const output = await skills({ ...ctx, skillsRegistry: registry as unknown as SkillsRegistry }, ['learning', 'on']);
    expect(output).toContain('user');
    await expect(ctx.setAutomaticSkillLearning!(true)).rejects.toThrow(/user/i);
    expect(persistSettings).not.toHaveBeenCalled();
  });

  it('never sends a Weka main-model extraction request', async () => {
    const { bridge, runtime, complete } = await setup();
    runtime.config.features!.adaptiveSkills = true;
    runtime.config.customProviders!.fixture!.model = 'weka';
    const ctx = await bridge.getCommandContext();
    await expect(ctx.skillLearning!.requestDraft({ id: 'explicit', taskId: 'task', scope: ctx.skillLearningScope!, kind: 'work', evidenceRefs: [] })).rejects.toThrow(/authorized/i);
    expect(complete).not.toHaveBeenCalled();
  });

  it('persists only the requested learning setting and preserves existing opt-ins', async () => {
    const { bridge, runtime, persistSettings } = await setup();
    runtime.config.skills = { excluded: ['private-skill'], learning: { enabled: false, scope: 'user' } };
    const ctx = await bridge.getCommandContext();
    await ctx.setAutomaticSkillLearning!(true);
    expect(persistSettings).toHaveBeenCalledWith({ enabled: true, scope: 'user' });
    expect(runtime.config.skills.excluded).toEqual(['private-skill']);
    expect(runtime.config.skills.learning?.enabled).toBe(true);
  });

  it('keeps identical queued instructions attributed to their captured signals and task identities', async () => {
    const { bridge, runtime } = await setup();
    runtime.config.features!.adaptiveSkills = true;
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    await bridge.beginSkillLearningTurn('Inspect the same output', first);
    const firstId = runtime.skillTaskId!;
    await bridge.beginSkillLearningTurn('Inspect the same output', second);
    const secondId = runtime.skillTaskId!;
    await bridge.finishSkillLearningTurn({ instruction: 'Inspect the same output', success: true, aborted: false }, first);
    const ctx = await bridge.getCommandContext();
    expect(await ctx.getSkillLearningOutcome!(`outcome:${firstId}`)).toMatchObject({ taskId: firstId });
    expect(await ctx.getSkillLearningOutcome!(`outcome:${secondId}`)).toBeNull();
    await bridge.finishSkillLearningTurn({ instruction: 'Inspect the same output', success: true, aborted: false }, second);
    expect(await ctx.getSkillLearningOutcome!(`outcome:${secondId}`)).toMatchObject({ taskId: secondId });
  });

  it('uses an authorized immutable source pin after an upstream edit and rejects oversized full instructions visibly', async () => {
    const { bridge, runtime, options, complete } = await setup();
    runtime.config.features!.adaptiveSkills = true;
    const sourceRoot = path.join(runtime.workspaceRoot, 'upstream');
    const files = new Map([['SKILL.md', Buffer.from('---\nname: source\ndescription: Frozen source\n---\n' + 'keep required constraint\n'.repeat(700))]]);
    await fs.outputFile(path.join(sourceRoot, 'SKILL.md'), files.get('SKILL.md')!);
    const manifest = createSkillRevisionManifest(files);
    const reference = { authority: 'fixture-upstream', packageId: 'source', revision: computeSkillRevision(manifest) };
    await new SkillRevisionStore(path.join(options.registry.getUserSkillsDir(), '.revisions')).publish({ reference, manifest, files });
    options.registry.getAdaptiveSession = () => ({ getPinnedReferences: () => [reference] });
    options.registry.getSkillRuntime = () => ({ resolve: () => ({ reference, name: 'source', description: 'Frozen source', source: 'fixture', scope: 'builtin', root: sourceRoot, enabled: true }) });
    const signal = new AbortController().signal;
    await bridge.beginSkillLearningTurn('Adapt the source workflow', signal);
    await bridge.finishSkillLearningTurn({ instruction: 'Adapt the source workflow', success: true, aborted: false }, signal);
    await fs.writeFile(path.join(sourceRoot, 'SKILL.md'), 'User-edited upstream');
    const ctx = await bridge.getCommandContext();
    await ctx.skillLearning!.requestDraft((await ctx.getSkillLearningOutcome!())!);
    await ctx.skillLearning!.processPending();
    expect(complete).not.toHaveBeenCalled();
    expect((await ctx.skillLearning!.jobs())[0]).toMatchObject({ state: 'cancelled', error: expect.stringContaining('Complete source instructions exceed') });
    expect(await fs.readFile(path.join(sourceRoot, 'SKILL.md'), 'utf8')).toBe('User-edited upstream');
  });

  it.each(['allowed', 'background-disabled', 'offline', 'bare'] as const)('runs actual configured acceptance checks only through the %s route', async route => {
    const { runtime, options, complete, bridge, registry } = await setup();
    await fs.writeFile(path.join(runtime.workspaceRoot, 'independent.cjs'), 'if(require("node:fs").readFileSync("output.txt","utf8")!=="after")process.exit(2)');
    await fs.writeFile(path.join(runtime.workspaceRoot, 'output.txt'), 'before');
    runtime.config.skills = { learning: { enabled: true, verification: { id: 'frozen-output-v1', inputIds: ['source-output'],
      checks: [{ id: 'output-check', command: [process.execPath, 'independent.cjs'], files: ['independent.cjs'] }], artifacts: ['output.txt'] } } };
    runtime.config.customProviders!.fixture!.backgroundCalls = route !== 'background-disabled';
    runtime.options.offline = route === 'offline';
    runtime.options.bare = route === 'bare';
    const checkPermission = vi.fn(() => ({ allowed: true as const, reason: 'allow_list' as const }));
    options.getPermissionManager = () => ({ checkPermission });
    const signal = new AbortController().signal;
    await bridge.beginSkillLearningTurn('Update the output artifact', signal);
    await fs.writeFile(path.join(runtime.workspaceRoot, 'output.txt'), 'after');
    await bridge.finishSkillLearningTurn({ instruction: 'Update the output artifact', success: true, aborted: false }, signal);
    const ctx = await bridge.getCommandContext();
    if (route === 'allowed') {
      await vi.waitFor(async () => expect(await ctx.skillLearning!.list()).toHaveLength(1));
      expect(complete).toHaveBeenCalledOnce();
      expect(checkPermission).toHaveBeenCalled();
      expect((await ctx.skillLearning!.list())[0]?.status).toBe('draft');
      await vi.waitFor(() => expect(registry.setLearnedCandidates.mock.calls.some(([candidates]) => candidates.length > 0)).toBe(true));
    } else {
      expect(complete).not.toHaveBeenCalled();
      expect(checkPermission).not.toHaveBeenCalled();
      expect(await ctx.skillLearning!.jobs()).toEqual([]);
    }
  });
});
