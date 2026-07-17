/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { VersionCheckResult } from '../../src/utils/versionCheck.js';

// Mock versionCheck module
vi.mock('../../src/utils/versionCheck.js', () => ({
  checkForUpdates: vi.fn(),
  detectChannel: vi.fn(),
  getInstallHint: vi.fn(),
}));

vi.mock('../../src/providers/modelCatalogUpdater.js', () => ({
  DEFAULT_MODEL_CATALOG_URL: 'https://code.autohand.ai/cli/models.json',
  refreshModelCatalog: vi.fn(),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Import after mocking
const { checkForUpdates, getInstallHint } = await import('../../src/utils/versionCheck.js');
const { spawn } = await import('node:child_process');
const { refreshModelCatalog } = await import('../../src/providers/modelCatalogUpdater.js');
const { runModelCatalogUpdate, runUpdate } = await import('../../src/commands/update.js');

function createFakeProcess(exitCode: number) {
  return {
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'close') cb(exitCode);
    }),
  };
}

describe('runUpdate', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('--check mode', () => {
    it('exits 0 when already up to date', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.7.14',
        isUpToDate: true,
        updateAvailable: false,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);

      await runUpdate({ currentVersion: '0.7.14', check: true });

      expect(checkForUpdates).toHaveBeenCalledWith('0.7.14', { forceCheck: true });
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('exits 1 when update is available', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.8.0',
        isUpToDate: false,
        updateAvailable: true,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);

      await runUpdate({ currentVersion: '0.7.14', check: true });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when version check fails with error', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: null,
        isUpToDate: true,
        updateAvailable: false,
        channel: 'stable',
        error: 'Network timeout',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);

      await runUpdate({ currentVersion: '0.7.14', check: true });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('install mode (default)', () => {
    it('exits 0 when already up to date', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.7.14',
        isUpToDate: true,
        updateAvailable: false,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);

      await runUpdate({ currentVersion: '0.7.14', check: false });

      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('exits 1 when latestVersion is null without error', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: null,
        isUpToDate: true,
        updateAvailable: false,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);

      await runUpdate({ currentVersion: '0.7.14', check: false });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('spawns install script for stable channel when update available', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.8.0',
        isUpToDate: false,
        updateAvailable: true,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);
      vi.mocked(getInstallHint).mockReturnValue('curl -fsSL https://autohand.ai/install.sh | sh');

      vi.mocked(spawn).mockReturnValue(createFakeProcess(0) as any);

      await runUpdate({ currentVersion: '0.7.14', check: false });

      expect(spawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'curl -fsSL https://autohand.ai/install.sh | sh'],
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('spawns install script with --alpha flag for alpha channel', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.15-alpha.abc1234',
        latestVersion: '0.7.15-alpha.def5678',
        isUpToDate: false,
        updateAvailable: true,
        channel: 'alpha',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);
      vi.mocked(getInstallHint).mockReturnValue('curl -fsSL https://autohand.ai/install.sh | sh -s -- --alpha');

      vi.mocked(spawn).mockReturnValue(createFakeProcess(0) as any);

      await runUpdate({ currentVersion: '0.7.15-alpha.abc1234', check: false });

      expect(spawn).toHaveBeenCalledWith(
        'sh',
        ['-c', 'curl -fsSL https://autohand.ai/install.sh | sh -s -- --alpha'],
        expect.objectContaining({ stdio: 'inherit' })
      );
    });

    it('exits with non-zero when install script fails', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.8.0',
        isUpToDate: false,
        updateAvailable: true,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);
      vi.mocked(getInstallHint).mockReturnValue('curl -fsSL https://autohand.ai/install.sh | sh');

      vi.mocked(spawn).mockReturnValue(createFakeProcess(1) as any);

      await runUpdate({ currentVersion: '0.7.14', check: false });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when spawn encounters an error', async () => {
      const result: VersionCheckResult = {
        currentVersion: '0.7.14',
        latestVersion: '0.8.0',
        isUpToDate: false,
        updateAvailable: true,
        channel: 'stable',
      };
      vi.mocked(checkForUpdates).mockResolvedValue(result);
      vi.mocked(getInstallHint).mockReturnValue('curl -fsSL https://autohand.ai/install.sh | sh');

      const fakeProcess = {
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'error') cb(new Error('spawn ENOENT'));
        }),
      };
      vi.mocked(spawn).mockReturnValue(fakeProcess as any);

      await runUpdate({ currentVersion: '0.7.14', check: false });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});

describe('runModelCatalogUpdate', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('forces a remote refresh and reports the persisted catalog revision', async () => {
    vi.mocked(refreshModelCatalog).mockResolvedValue({
      status: 'updated',
      path: '/tmp/autohand/models.json',
      checkedAt: 1_000,
      providerCount: 15,
      modelCount: 101,
      revision: 'sha256-example',
    });

    await runModelCatalogUpdate({ currentVersion: '0.8.2' });

    expect(refreshModelCatalog).toHaveBeenCalledWith(expect.objectContaining({
      force: true,
      offline: false,
      userAgent: 'autohand/0.8.2',
    }));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('101 models'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('sha256-example'));
  });
});
