import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { inspectProviderTimeout } from '../../src/testing/scenarios/providerTimeoutScenario.js';
import { createTempAutohandHome, createMockOllamaServer, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('provider timeout defaults', () => {
  it('shows an Anthropic value raised by the provider in the real status view', async () => {
    const state = await createTempAutohandHome({ config: {
      provider: 'anthropic', anthropic: { apiKey: 'fixture-only', model: 'claude-sonnet-5-5' },
      network: { timeout: 5000 },
    } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 150, rows: 35 });
      await inspectProviderTimeout(session, '600 s (set to 5 s, raised by the provider)');
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally { session?.close(); await state.cleanup(); }
  }, 60_000);

  it('migrates the thirty-second default and shows real provider budgets in status', async () => {
    const server = await createMockOllamaServer(['fixture-model']);
    const state = await createTempAutohandHome({ config: { provider: 'ollama', ollama: { baseUrl: server.baseUrl, model: 'fixture-model' }, network: { timeout: 30000, maxRetries: 2 } } });
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 140, rows: 35, waitForDataTimeout: 15_000 });
    try {
      const screen = await inspectProviderTimeout(session);
      expect(screen).not.toContain('30000ms');
      const config = JSON.parse(await readFile(state.configPath, 'utf8'));
      expect(config.network.timeout).toBeUndefined();
      expect(config.network.maxRetries).toBe(2);
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally {
      session.close();
      await server.close();
      await state.cleanup();
    }
  }, 60_000);
});
