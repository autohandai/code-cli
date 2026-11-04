import type { Session } from 'tuistory';
import { describe, expect, it } from 'vitest';
import { createProviderFailureFixture, inspectProviderFailure } from '../../src/testing/scenarios/providerFailureScenario.js';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('provider outage guidance in the composer', () => {
  it.each([
    { provider: 'autohandai', statusUrl: 'https://status.autohand.ai' },
    { provider: 'openrouter', statusUrl: 'https://status.openrouter.ai' },
  ])('shows $provider status once and restores editable input', async ({ provider, statusUrl }) => {
    const server = await createProviderFailureFixture();
    let auth: Awaited<ReturnType<typeof createMockAuthServer>> | undefined;
    let state: Awaited<ReturnType<typeof createTempAutohandHome>> | undefined;
    let session: Session | undefined;
    try {
      auth = await createMockAuthServer();
      state = await createTempAutohandHome({ config: {
        provider, features: { fullScreenMode: true, adaptiveSkills: true, autohand_inference: true },
        autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-key', model: 'moa', baseUrl: server.baseUrl, backgroundCalls: false, maxConcurrentThreads: 1 },
        openrouter: { baseUrl: server.baseUrl },
        agent: { autoMemory: false, sessionRetryLimit: 0 }, network: { maxRetries: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      } });
      session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 45,
        env: { HOME: state.autohandHome, AUTOHAND_API_URL: auth.baseUrl, AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
      });
      const screen = await inspectProviderFailure(session, statusUrl);
      expect(screen.split(statusUrl)).toHaveLength(2);
      expect(screen).toContain('Fixture service failure');
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally {
      try {
        session?.close();
      } finally {
        const cleanup = await Promise.allSettled([state?.cleanup(), auth?.close(), server.close()]);
        for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
      }
    }
  });
});
