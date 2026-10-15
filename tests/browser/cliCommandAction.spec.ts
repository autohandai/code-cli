/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  applyChromeSettings: vi.fn(),
  installNativeHost: vi.fn(async () => ({ targets: [] })),
  loadConfig: vi.fn(async () => ({ chrome: {} })),
  saveConfig: vi.fn(async () => undefined),
}));

vi.mock('chalk', () => ({
  default: {
    gray: (value: string) => value,
    green: (value: string) => value,
    yellow: (value: string) => value,
  },
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
}));

vi.mock('../../src/browser/chrome.js', () => ({
  applyChromeSettings: mocks.applyChromeSettings,
  buildChromeOpenUrl: vi.fn(() => 'about:blank'),
  CHROME_WEB_STORE_EXTENSION_ID: 'lljmbfgiogeolajngfkodakhlglkipbj',
  DEFAULT_CHROME_INSTALL_URL: 'https://autohand.ai/chrome/installed',
  detectExtensionProfile: vi.fn(async () => null),
  installNativeHost: mocks.installNativeHost,
  normalizeBrowsers: vi.fn(() => ['chrome']),
  openChromeContinuation: vi.fn(async () => undefined),
  resolveCliLaunchSpec: vi.fn(() => ({ command: 'autohand', args: [] })),
}));

const { registerBrowserCommand } = await import('../../src/browser/cliCommand.js');

function createProgram(): Command {
  const program = new Command().name('autohand');
  registerBrowserCommand(program);
  return program;
}

describe('browser install command routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the canonical browser install command without a migration warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await createProgram().parseAsync(['node', 'autohand', 'browser', 'install']);

      expect(mocks.installNativeHost).toHaveBeenCalledOnce();
      expect(mocks.saveConfig).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('pairs the native host with the Chrome Web Store extension when no id is given', async () => {
    await createProgram().parseAsync(['node', 'autohand', 'browser', 'install']);

    expect(mocks.installNativeHost).toHaveBeenCalledWith(
      expect.objectContaining({ extensionIds: ['lljmbfgiogeolajngfkodakhlglkipbj'] }),
    );
    expect(mocks.applyChromeSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ extensionId: 'lljmbfgiogeolajngfkodakhlglkipbj' }),
    );
  });

  it('prefers an explicit --extension-id over the store default', async () => {
    await createProgram().parseAsync(['node', 'autohand', 'browser', 'install', '--extension-id', 'unpackedid']);

    expect(mocks.installNativeHost).toHaveBeenCalledWith(
      expect.objectContaining({ extensionIds: ['unpackedid'] }),
    );
  });

  it('prefers a configured extension id over the store default', async () => {
    mocks.loadConfig.mockResolvedValueOnce({ chrome: { extensionId: 'configuredid' } } as never);

    await createProgram().parseAsync(['node', 'autohand', 'browser', 'install']);

    expect(mocks.installNativeHost).toHaveBeenCalledWith(
      expect.objectContaining({ extensionIds: ['configuredid'] }),
    );
  });

  it('routes the hidden Chrome command and emits a migration warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await createProgram().parseAsync(['node', 'autohand', 'chrome', 'install']);

      expect(mocks.installNativeHost).toHaveBeenCalledOnce();
      expect(mocks.saveConfig).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        'The "autohand chrome" command is retained only for compatibility. Use "autohand browser" instead.',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
