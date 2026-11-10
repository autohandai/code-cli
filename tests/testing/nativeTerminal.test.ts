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

function preparedLaunchArguments(): unknown {
  const environmentWrite = vi.mocked(execFileSync).mock.calls.find(([file]) => file === '/usr/bin/python3');
  const environment: unknown = JSON.parse(String(environmentWrite?.[1]?.[3]));
  if (!environment || typeof environment !== 'object' || !('AUTOHAND_NATIVE_LAUNCH_ARGUMENTS' in environment)
    || typeof environment.AUTOHAND_NATIVE_LAUNCH_ARGUMENTS !== 'string') {
    throw new Error('Native test launch arguments were not passed to XCTest');
  }
  return JSON.parse(environment.AUTOHAND_NATIVE_LAUNCH_ARGUMENTS);
}

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

  it.each(['idle', 'streaming'])('prepares an isolated %s VS Code profile with native renderer accessibility', async mode => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'vscode');

    const test = await prepareNativeTerminalTest();

    const profile = path.resolve('.artifacts/native-terminal/vscode/vscode-profile', mode);
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
    const launchArguments = preparedLaunchArguments();
    expect(launchArguments).toMatchObject({
      [mode]: expect.arrayContaining([
        '--force-renderer-accessibility', '--user-data-dir', profile,
        '--extensions-dir', path.join(profile, 'extensions'), '--disable-extensions',
      ]),
    });
    expect(launchArguments).toMatchObject({
      idle: expect.not.arrayContaining([path.resolve('.artifacts/native-terminal/vscode/vscode-profile/streaming')]),
      streaming: expect.not.arrayContaining([path.resolve('.artifacts/native-terminal/vscode/vscode-profile/idle')]),
    });
    expect(test.args[0]).toBe('test-without-building');
    expect(test.resultBundle).toBe(path.resolve('.artifacts/native-terminal/vscode/NativeTerminal.xcresult'));
    expect(execFileSync).not.toHaveBeenCalledWith('/usr/bin/xcodebuild', expect.arrayContaining(['test-without-building']), expect.anything());
  });

  it.each([
    { terminal: 'iterm2', arguments: [] },
    { terminal: 'cmux', arguments: [] },
    { terminal: 'ghostty', arguments: ['--config-default-files=false', '--confirm-close-surface=false'] },
  ])('preserves the $terminal launch arguments for both native scenarios', async fixture => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', fixture.terminal);
    await prepareNativeTerminalTest();
    expect(preparedLaunchArguments()).toEqual({ idle: fixture.arguments, streaming: fixture.arguments });
  });
});
