/** @license Apache-2.0 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareNativeTerminalTest } from '../../src/testing/drivers/native-terminal-driver.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '/test/bin/bun\n') }));
vi.mock('node:fs/promises', () => ({
  copyFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(),
  mkdtemp: vi.fn(async () => '/private/tmp/ah-vsc-123456'),
  readdir: vi.fn(async () => ['TerminalLab_macosx.xctestrun']),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function preparedLaunchArguments(): Record<string, string[]> {
  const environmentWrite = vi.mocked(execFileSync).mock.calls.find(([file]) => file === '/usr/bin/python3');
  const environment: unknown = JSON.parse(String(environmentWrite?.[1]?.[3]));
  if (!environment || typeof environment !== 'object' || !('AUTOHAND_NATIVE_LAUNCH_ARGUMENTS' in environment)
    || typeof environment.AUTOHAND_NATIVE_LAUNCH_ARGUMENTS !== 'string') {
    throw new Error('Native test launch arguments were not passed to XCTest');
  }
  const parsed: unknown = JSON.parse(environment.AUTOHAND_NATIVE_LAUNCH_ARGUMENTS);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid native launch argument map');
  const result: Record<string, string[]> = {};
  for (const [mode, argumentsForMode] of Object.entries(parsed)) {
    if (!Array.isArray(argumentsForMode) || !argumentsForMode.every((argument: unknown) => typeof argument === 'string')) {
      throw new Error('Invalid native launch arguments');
    }
    result[mode] = argumentsForMode;
  }
  return result;
}

describe('native terminal automation boundary', () => {
  it.each(['idle', 'streaming'])('focuses the existing terminal before each native copy in the isolated %s VS Code profile', async mode => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'vscode');
    await prepareNativeTerminalTest();
    const evidence = path.resolve('.artifacts/native-terminal/vscode/vscode-profile', mode, 'User/keybindings.json');
    const bindingWrite = vi.mocked(writeFile).mock.calls.find(([file]) => file === evidence);
    expect(bindingWrite).toBeDefined();
    const bindings: unknown = JSON.parse(String(bindingWrite?.[1]));
    expect(bindings).toEqual([{
      key: 'ctrl+shift+y', command: 'runCommands', when: 'terminalIsOpen', args: {
        commands: [
          'workbench.action.terminal.focus',
          'workbench.action.terminal.selectAll',
          'workbench.action.terminal.copyAndClearSelection',
        ],
      },
    }]);
    expect(copyFile).toHaveBeenCalledWith(evidence, path.join('/private/tmp/ah-vsc-123456', mode, 'User/keybindings.json'));
  });

  it.each(['idle', 'streaming'])('keeps the %s VS Code main socket below the macOS Unix socket limit in the Actions checkout', async mode => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('AUTOHAND_NATIVE_TERMINAL', 'vscode');
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/runner/work/code-cli/code-cli');
    await prepareNativeTerminalTest();
    const argumentsForMode = preparedLaunchArguments()[mode];
    const profile = argumentsForMode[argumentsForMode.indexOf('--user-data-dir') + 1];
    expect(profile).toBeDefined();
    expect(Buffer.byteLength(path.join(profile, '1.14-main.sock'))).toBeLessThan(104);
  });

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
    const runtimeProfile = path.join('/private/tmp/ah-vsc-123456', mode);
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
        '--force-renderer-accessibility', '--user-data-dir', runtimeProfile,
        '--extensions-dir', path.join(runtimeProfile, 'extensions'), '--disable-extensions',
      ]),
    });
    expect(launchArguments).toMatchObject({
      idle: expect.not.arrayContaining([path.join('/private/tmp/ah-vsc-123456', 'streaming')]),
      streaming: expect.not.arrayContaining([path.join('/private/tmp/ah-vsc-123456', 'idle')]),
    });
    expect(copyFile).toHaveBeenCalledWith(path.join(profile, 'User', 'settings.json'), path.join(runtimeProfile, 'User', 'settings.json'));
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
