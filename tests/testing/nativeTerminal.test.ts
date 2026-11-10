/** @license Apache-2.0 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareNativeTerminalTest } from '../../src/testing/drivers/native-terminal-driver.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '/test/bin/bun\n') }));
vi.mock('node:fs/promises', () => ({
  copyFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
  readdir: vi.fn(async () => ['TerminalLab_macosx.xctestrun']),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('native terminal automation boundary', () => {
  it('refuses to launch or terminate applications on a developer machine', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    await expect(prepareNativeTerminalTest()).rejects.toThrow('isolated macOS GitHub Actions runner');
    expect(execFileSync).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'darwin')('rejects an unknown terminal before generating or launching a test', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'unknown');
    await expect(prepareNativeTerminalTest()).rejects.toThrow('Choose iterm2, ghostty, cmux, or vscode');
  });

  it('prepares a disposable VS Code profile without Copilot onboarding while retaining terminal accessibility and scrollback', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'vscode');

    const test = await prepareNativeTerminalTest();

    const profile = path.resolve('.artifacts/native-terminal/vscode/vscode-profile');
    const settingsWrite = vi.mocked(writeFile).mock.calls.find(([file]) => file === path.join(profile, 'User/settings.json'));
    expect(settingsWrite).toBeDefined();
    const settings: unknown = JSON.parse(String(settingsWrite?.[1]));
    expect(settings).toMatchObject({
      'chat.disableAIFeatures': true,
      'editor.accessibilitySupport': 'on',
      'window.restoreWindows': 'none',
      'terminal.integrated.enablePersistentSessions': false,
      'terminal.integrated.scrollback': 5000,
    });
    expect(test.args[0]).toBe('test-without-building');
    expect(test.resultBundle).toBe(path.resolve('.artifacts/native-terminal/vscode/NativeTerminal.xcresult'));
    expect(execFileSync).not.toHaveBeenCalledWith('/usr/bin/xcodebuild', expect.arrayContaining(['test-without-building']), expect.anything());
  });
});
