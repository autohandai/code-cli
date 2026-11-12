import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';
import { configureSubagentIterationLimit } from '../../src/testing/scenarios/subagentIterationSettingsScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('sub-agent iteration settings Tuistory', () => {
  it('rejects an invalid cap, saves a separate worker cap and returns to the composer', async () => {
    const state = await createTempAutohandHome({ config: {
      agent: { maxIterations: 300 }, features: { automaticSpecialists: false }, ui: { promptSuggestions: false },
    } });
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 36,
      });
      expect(await configureSubagentIterationLimit(session, 60)).toContain('integer between 1 and 1000');
      expect(await fs.readJson(state.configPath)).toMatchObject({ agent: { maxIterations: 300, subagentMaxIterations: 60 } });
      await exitInteractive(session);
    } finally { session?.close(); await state.cleanup(); }
  }, 90_000);
});
