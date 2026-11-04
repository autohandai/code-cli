import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { inspectBrowserBridgeInstall } from '../../src/testing/scenarios/browserInstallScenario.js';
import { createTempAutohandHome, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe.skipIf(process.platform === 'win32')('browser bridge pairing in a real terminal', () => {
  it.each([undefined, 'unpackedfixtureid'])('pairs with the store default or explicit id (%s)', async extensionId => {
    const state = await createTempAutohandHome();
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        'browser', 'install', '--config', state.configPath,
        ...(extensionId ? ['--extension-id', extensionId] : []),
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { HOME: state.autohandHome } });
      const result = await inspectBrowserBridgeInstall(session, state.autohandHome);
      const expected = extensionId ?? 'lljmbfgiogeolajngfkodakhlglkipbj';
      expect(result.allowedOrigins).toContain(`chrome-extension://${expected}/`);
      expect(result.output).toContain('Installed Autohand browser bridge.');
      if (!extensionId) expect(result.output).toContain('paired with the Chrome Web Store extension');
      expect(result.savedExtensionId).toBe(expected);
    } finally {
      session?.close();
      await state.cleanup();
    }
  });
});
