import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { seedResumeScenario, inspectSdkSessionResume } from '../../src/testing/scenarios/resumeScenario.js';
import { createMockAuthServer, createMockOpenRouterSequenceServer, createTempAutohandHome, launchBuiltAutohand, waitForExit } from './helpers/autohandTuistory.js';

describe('SDK startup contract in real terminals', () => {
  it.each([
    { profile: ['--answer-only'] }, { profile: ['--setup-only'] }, { profile: ['--client-context', 'blueprint'] },
  ])('rejects private settings in a restricted profile (%j)', async ({ profile }) => {
    const state = await createTempAutohandHome();
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--mode', 'rpc', '--config', state.configPath, '--path', state.workspaceRoot,
        '--sdk-settings-version', '1', ...profile,
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { HOME: state.autohandHome, AUTOHAND_RUN_SETTINGS: '{"features":{"slashGoal":false}}' },
      });
      await session.waitForText('SDK run settings are unavailable in restricted RPC profiles.', { timeout: 5_000 });
      await waitForExit(session, 5_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(1);
    } finally {
      session?.close();
      await state.cleanup();
    }
  });
  it('restores persisted RPC history once without creating an unrelated session', async () => {
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: { agent: { autoMemory: false } } });
    let session: Session | undefined;
    try {
      await seedResumeScenario(state.autohandHome, state.workspaceRoot);
      session = await launchBuiltAutohand([
        '--mode', 'rpc', '--bare', '--config', state.configPath, '--path', state.workspaceRoot,
        '--sdk-session-reference', 'resume-newer',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { HOME: state.autohandHome, AUTOHAND_AUTH_API_URL: auth.baseUrl, AUTOHAND_API_URL: auth.baseUrl },
      });
      const messages = await inspectSdkSessionResume(session);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
      const starts = messages.filter(message => message.method === 'autohand.agentStart');
      expect(starts).toHaveLength(1);
      expect(starts[0].params?.sessionId).toBe('resume-newer');
      const hooks = messages.filter(message => message.method === 'autohand.hook.sessionStart');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].params?.sessionType).toBe('resume');
      expect(messages.find(message => message.id === 71 && 'result' in message)?.result).toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ content: 'Investigate why the terminal caret disappears after a resize.' })]),
      });
      const index = JSON.parse(await fs.readFile(`${state.autohandHome}/sessions/index.json`, 'utf8'));
      expect(index.sessions).toHaveLength(3);
    } finally {
      session?.close();
      await state.cleanup();
      await auth.close();
    }
  });
  it('applies the private provider overlay before construction and preserves the saved configuration', async () => {
    const model = await createMockOpenRouterSequenceServer([JSON.stringify({ toolCalls: [], finalResponse: 'SDK_STARTUP_OVERRIDE_OK' })]);
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: 'http://127.0.0.1:9/unused' }, agent: { autoMemory: false } } });
    let session: Session | undefined;
    const original = await fs.readFile(state.configPath, 'utf8');
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--sdk-settings-version', '1', '-p', 'Reply with the marker'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { HOME: state.autohandHome, AUTOHAND_RUN_SETTINGS: JSON.stringify({ openrouter: { baseUrl: model.baseUrl } }), AUTOHAND_AUTH_API_URL: auth.baseUrl, AUTOHAND_API_URL: auth.baseUrl },
      });
      await waitForExit(session, 30_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
      expect(session.readAll()).toContain('SDK_STARTUP_OVERRIDE_OK');
      expect(model.requests).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(state.configPath, 'utf8')).openrouter).toEqual(JSON.parse(original).openrouter);
    } finally { session?.close(); await state.cleanup(); await model.close(); await auth.close(); }
  });

  it.each([false, true])('rejects unavailable fork startup instead of creating a fresh session (feature enabled: %s)', async enabled => {
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: { provider: 'ollama', ollama: { model: 'fixture', baseUrl: 'http://127.0.0.1:9' }, features: { experimentalFork: enabled } } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--mode', 'rpc', '--bare', '--path', state.workspaceRoot, '--config', state.configPath, '--fork', 'missing-sdk-source'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { HOME: state.autohandHome, AUTOHAND_AUTH_API_URL: auth.baseUrl, AUTOHAND_API_URL: auth.baseUrl },
      });
      await waitForExit(session, 15_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(1);
      expect(session.readAll()).toContain('initialization_failed');
      expect(session.readAll()).not.toContain('autohand.agentStart');
    } finally { session?.close(); await state.cleanup(); await auth.close(); }
  });
});
