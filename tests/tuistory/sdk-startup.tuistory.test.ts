import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { createMockAuthServer, createMockOpenRouterSequenceServer, createTempAutohandHome, launchBuiltAutohand, waitForExit } from './helpers/autohandTuistory.js';

describe('SDK startup contract in real terminals', () => {
  it('applies the private provider overlay before construction and preserves the saved configuration', async () => {
    const model = await createMockOpenRouterSequenceServer([JSON.stringify({ toolCalls: [], finalResponse: 'SDK_STARTUP_OVERRIDE_OK' })]);
    const auth = await createMockAuthServer();
    const state = await createTempAutohandHome({ config: { openrouter: { baseUrl: 'http://127.0.0.1:9/unused' }, agent: { autoMemory: false } } });
    let session: Session | undefined;
    const original = await fs.readFile(state.configPath, 'utf8');
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--sdk-settings-version', '1', '-p', 'Reply with the marker'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_RUN_SETTINGS: JSON.stringify({ openrouter: { baseUrl: model.baseUrl } }), AUTOHAND_AUTH_API_URL: auth.baseUrl, AUTOHAND_API_URL: auth.baseUrl },
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
        env: { AUTOHAND_AUTH_API_URL: auth.baseUrl, AUTOHAND_API_URL: auth.baseUrl },
      });
      await waitForExit(session, 15_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(1);
      expect(session.readAll()).toContain('initialization_failed');
      expect(session.readAll()).not.toContain('autohand.agentStart');
    } finally { session?.close(); await state.cleanup(); await auth.close(); }
  });
});
