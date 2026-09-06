import { describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import type { Session } from 'tuistory';
import {
  createMockAuthServer,
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  expectCleanExit,
  exitInteractive,
  launchBuiltAutohand,
  waitForExit,
} from './helpers/autohandTuistory.js';

describe('provider environment startup', () => {
  it('uses Autohand AI for an actual prompt while preserving saved provider selections', async () => {
    const auth = await createMockAuthServer();
    const provider = await createMockAutohandAINativeSequenceServer([
      { content: 'PROCESS_PROVIDER_OVERRIDE_OK' },
    ]);
    const state = await createTempAutohandHome({ config: {
      provider: 'openrouter',
      openrouter: { baseUrl: auth.baseUrl },
      features: { autohand_inference: true },
      agent: { maxIterations: 2, sessionRetryLimit: 0, autoMemory: false },
      network: { maxRetries: 0, retryDelay: 0 },
    } });
    const localPath = path.join(state.workspaceRoot, '.autohand', 'settings.local.json');
    await fs.outputJson(localPath, { provider: 'openrouter' });
    const originalConfig = await fs.readFile(state.configPath, 'utf8');
    const originalLocal = await fs.readFile(localPath, 'utf8');
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath,
        '--prompt', 'Reply with the provider fixture marker.', '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_PROVIDER: 'autohandai',
          AUTOHAND_AI_API_KEY: 'fixture-inference-key',
          AUTOHAND_AI_BASE_URL: provider.baseUrl,
          AUTOHAND_AI_PLAN: 'cloud',
          AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth`,
        },
        waitForDataTimeout: 15_000,
      });
      await waitForExit(session, 30_000);
      expect(session.readAll()).toContain('PROCESS_PROVIDER_OVERRIDE_OK');
      expect(provider.requests).toHaveLength(1);
      expectCleanExit(session);
      const saved = await fs.readJson(state.configPath);
      expect(saved.provider).toBe(JSON.parse(originalConfig).provider);
      expect(saved.autohandai).toBeUndefined();
      expect(await fs.readFile(localPath, 'utf8')).toBe(originalLocal);
    } finally {
      if (session && !session.exitInfo) await exitInteractive(session);
      await Promise.all([provider.close(), auth.close(), state.cleanup()]);
    }
  }, 45_000);
});
