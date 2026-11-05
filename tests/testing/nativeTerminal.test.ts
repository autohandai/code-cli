/** @license Apache-2.0 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNativeTerminalTest } from '../../src/testing/drivers/native-terminal-driver.js';

afterEach(() => vi.unstubAllEnvs());

describe('native terminal automation boundary', () => {
  it('refuses to launch or terminate applications on a developer machine', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    await expect(prepareNativeTerminalTest()).rejects.toThrow('isolated macOS GitHub Actions runner');
  });
  it.skipIf(process.platform !== 'darwin')('rejects an unknown terminal before generating or launching a test', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'unknown');
    await expect(prepareNativeTerminalTest()).rejects.toThrow('Choose iterm2, ghostty, cmux, or vscode');
  });
});
