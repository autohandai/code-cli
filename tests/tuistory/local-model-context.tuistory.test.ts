import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { createLocalModelContextFixture, inspectLocalModelContext } from '../../src/testing/scenarios/localModelContextScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('local model runtime context', () => {
  it('uses the server context in requests and the composer while keeping input available', async () => {
    const server = await createLocalModelContextFixture();
    const state = await createTempAutohandHome({ config: {
      provider: 'llamacpp',
      llamacpp: { baseUrl: server.baseUrl, model: 'canvas-pirate' },
      agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { terminalBell: false, showCompletionNotification: false, promptSuggestions: false },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--config', state.configPath, '--path', state.workspaceRoot, '--yes',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      const screen = await inspectLocalModelContext(session);
      expect(server.metadataRequests).toContain('/props?model=canvas-pirate&autoload=false');
      expect(server.completions[0]).toMatchObject({ model: 'canvas-pirate', max_tokens: 8192 });
      expect(screen).toContain('32.8k');
      expect(screen).toContain('local context draft');
      await exitInteractive(session);
      session = undefined;
    } finally {
      session?.close();
      await server.close();
      await state.cleanup();
    }
  });
});
