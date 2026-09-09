import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { PtyDriver } from '../../src/testing/drivers/pty-driver.js';
import { runDiscoveryProgressPtyScenario } from '../../src/testing/scenarios/discoveryScenario.js';

const driver = new PtyDriver();
afterEach(() => driver.close());
describe('discovery progress in a real terminal', () => {
  it('renders the active upload and accepts Ctrl+C', async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const screen = await runDiscoveryProgressPtyScenario(
      driver,
      process.execPath,
      [
        '--import',
        path.join(root, 'node_modules/tsx/dist/loader.mjs'),
        path.join(root, 'src/testing/scenarios/discoveryProgressFixture.tsx'),
      ],
      root
    );
    expect(screen).toContain('Upload workflows');
    expect(screen).toContain('Ctrl+C to cancel');
  });
});
