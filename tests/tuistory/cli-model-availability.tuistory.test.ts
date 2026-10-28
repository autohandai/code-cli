import { expect, it } from 'vitest';
import { createTempAutohandHome, launchBuiltAutohand } from './helpers/autohandTuistory.js';

it('explains the API and Agent SDK route when Weka is selected explicitly', async () => {
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai', features: { autohand_inference: true },
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', model: 'fantail' },
  } });
  const session = await launchBuiltAutohand(['--model', 'weka', '--config', state.configPath], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
  try {
    await session.waitForText('Weka is available through the Autohand API and Agent SDKs, not in the CLI.', { timeout: 20_000 });
    expect(session.readAll().replace(/\s+/g, ' ')).toContain('Weka is available through the Autohand API and Agent SDKs, not in the CLI. Pick another model with /model or --model.');
  } finally {
    session.close();
    await state.cleanup();
  }
});
