import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectFreeSearchAllowance } from '../../src/testing/scenarios/freeSearchScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('Free web search allowance in the built terminal', () => {
  it.each([7, 0])('shows %s searches left, supports cancel, and exits cleanly', async remaining => {
    const state = await createTempAutohandHome({ config: {
      provider: 'openrouter', openrouter: { apiKey: 'fixture', model: 'fixture' }, auth: { token: 'ahc_verified_free' },
      search: { provider: 'browser-profile' }, agent: { autoMemory: false },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      const preload = fileURLToPath(new URL('../../src/testing/fixtures/free-search-fetch.mjs', import.meta.url));
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 140, rows: 45,
        env: { NODE_OPTIONS: `--import=${preload}`, AUTOHAND_TEST_SEARCH_REMAINING: String(remaining) },
      });
      await inspectFreeSearchAllowance(session, remaining);
      await exitInteractive(session);
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally {
      session?.close(); await session?.waitForExit(5000); await state.cleanup();
    }
  });
});
