import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import path from 'node:path';
import fs from 'fs-extra';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { SessionManager } from '../../src/session/SessionManager.js';
import { ensureSkillWorkspaceIdentity } from '../../src/skills/workspaceIdentity.js';
import { inspectRecoveredCheckpointAndRefuseStaleResume, pauseGoalWithFixtureSkill, resumeGoalWithPinnedSkill } from '../../src/testing/scenarios/goalContinuityScenario.js';
import { createMockAuthServer, createMockOpenRouterSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('built CLI pinned checkpoint startup', () => {
  it('restores metadata paused and refuses a stale context without making a provider request', async () => {
    const auth = await createMockAuthServer();
    const server = await createMockOpenRouterSequenceServer(['SHOULD_NOT_RUN']);
    const state = await createTempAutohandHome({ config: {
      features: { slashGoal: true, adaptiveSkills: true }, openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false }, ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let terminal: Session | undefined;
    try {
      const sessions = new SessionManager(path.join(state.autohandHome, 'sessions')); await sessions.initialize();
      const saved = await sessions.createSession(state.workspaceRoot, 'test-model');
      const manager = new GoalManager(state.workspaceRoot, { sessionId: saved.metadata.sessionId });
      await manager.createGoal({ objective: 'Verify the approved saved artifact' });
      const workspaceId = await ensureSkillWorkspaceIdentity(state.workspaceRoot);
      const metadata = await fs.readJson(path.resolve(import.meta.dirname, '../../package.json'));
      await manager.updateGoal({ checkpoint: { summary: 'Artifact prepared before restart', nextStep: 'Observe and verify the saved artifact', artifacts: ['artifact:fixture'],
        continuity: { version: 1, approvedIntent: 'Verify the approved saved artifact', workspaceId,
          skills: [{ authority: 'local:fixture', packageId: 'missing-revision', revision: 'sha256:missing', resource: 'SKILL.md' }], checkReferences: ['check:fixture'], pendingEffects: [],
          freshness: { runtimeVersion: metadata.version, providerId: 'openrouter', permissionEpoch: 'stale-fixture-permissions', capturedAt: Date.now() } },
      } });
      await manager.enqueueGoal({ objective: 'Preserve the next approved objective', source: 'command' });
      await sessions.closeSession('Saved conversation for restart verification');
      terminal = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '-r', saved.metadata.sessionId], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
      });
      await inspectRecoveredCheckpointAndRefuseStaleResume(terminal, async () => {
        await vi.waitFor(async () => {
          expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused');
          expect(server.requests).toHaveLength(0);
        }, { timeout: 15_000 });
        expect(server.requests).toHaveLength(0);
      });
      const restored = await manager.getSessionSnapshot();
      expect(restored.goal).toMatchObject({ status: 'paused', checkpoint: { summary: 'Artifact prepared before restart', continuity: { skills: [{ revision: 'sha256:missing' }] } } });
      expect(restored.queue).toHaveLength(1); expect(server.requests).toHaveLength(0);
      expect(terminal.readAll()).toContain('Cannot resume');
      expect(terminal.readAll()).toMatch(/(?:runtimeVersion|providerId|permissionEpoch|workspaceId) changed/);
      expect(terminal.readAll()).not.toContain('current context validation is unavailable');
      await exitInteractive(terminal);
    } finally {
      if (terminal && !terminal.exitInfo) await exitInteractive(terminal).catch(() => {});
      terminal?.close(); await server.close(); await auth.close(); await state.cleanup();
    }
  });
  it('resumes a real saved pin in a second process after establishing current automode permissions', async () => {
    const auth = await createMockAuthServer();
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status: 'paused', checkpoint: { summary: 'Real submitted skill checkpoint', nextStep: 'Verify the saved artifact' } } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_PAUSED_WITH_PIN' }),
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status: 'complete' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_RESUMED_WITH_PIN' }),
    ]);
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true, adaptiveSkills: true }, openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 }, network: { maxRetries: 0, retryDelay: 0 },
      ui: { defaultInteractionMode: 'default', promptSuggestions: false, showCompletionNotification: false, terminalBell: false } } });
    let first: Session | undefined; let second: Session | undefined;
    try {
      const skillPath = path.join(state.autohandHome, 'skills/continuity-checks/SKILL.md');
      const header = '---\nname: continuity-checks\ndescription: Verify approved saved artifacts\n---\n';
      await fs.outputFile(skillPath, `${header}ORIGINAL_PINNED_VERIFICATION_PROCEDURE. Verify independent checks before claiming completion.`);
      const launch = { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` } };
      first = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], launch);
      await pauseGoalWithFixtureSkill(first);
      const snapshot = await new GoalManager(state.workspaceRoot).getSnapshot(); const [ownerId, saved] = Object.entries(snapshot.goals)[0];
      expect(saved.status).toBe('paused'); expect(saved.checkpoint?.continuity?.skills).toHaveLength(1);
      expect(saved.checkpoint?.continuity?.freshness.permissionEpoch).toMatch(/^sha256:[a-f0-9]{64}$/);
      await exitInteractive(first); first.close();
      expect((await fs.readJson(state.configPath)).auth?.token).toBe('tuistory-test-token');
      await fs.writeFile(skillPath, `${header}UNAPPROVED_LIVE_REPLACEMENT_PROCEDURE.`);
      const beforeResume = server.requests.length;
      second = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '-r', ownerId], launch);
      await resumeGoalWithPinnedSkill(second, async () => {
        expect((await new GoalManager(state.workspaceRoot).getSnapshot()).goals[ownerId].status).toBe('paused');
        expect(server.requests).toHaveLength(beforeResume);
      });
      const completed = await vi.waitFor(async () => {
        const goal = (await new GoalManager(state.workspaceRoot).getSnapshot()).goals[ownerId];
        expect(goal.status).toBe('complete');
        return goal;
      }, { timeout: 10_000, interval: 50 });
      expect(completed.checkpoint?.continuity?.skills).toEqual(saved.checkpoint?.continuity?.skills);
      const resumedRequests = JSON.stringify(server.requests.slice(beforeResume));
      expect(resumedRequests).toContain('ORIGINAL_PINNED_VERIFICATION_PROCEDURE'); expect(resumedRequests).not.toContain('UNAPPROVED_LIVE_REPLACEMENT_PROCEDURE');
      await exitInteractive(second);
    } finally {
      for (const terminal of [second, first]) { if (terminal && !terminal.exitInfo) await exitInteractive(terminal).catch(() => {}); terminal?.close(); }
      await server.close(); await auth.close(); await state.cleanup();
    }
  });

});
