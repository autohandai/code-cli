/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMock = vi.fn();
const managerCtorMock = vi.fn();
const reportErrorMock = vi.fn();

vi.mock('../../package.json', () => ({
  default: { version: '0.8.0' },
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../../src/reporting/AutoReportManager.js', () => ({
  AutoReportManager: class AutoReportManager {
    constructor(config: unknown, version: string) {
      managerCtorMock(config, version);
    }

    reportError = reportErrorMock;
  }
}));

import {
  installProcessErrorHandlers,
  reportProcessError,
  resetProcessErrorReportingForTests,
} from '../../src/reporting/processErrorReporting.js';

type FakeProcess = EventEmitter & {
  argv: string[];
  env: Record<string, string | undefined>;
  exit: ReturnType<typeof vi.fn>;
  stdin: { fd: number };
};

function createFakeProcess(argv: string[] = ['node', 'autohand']): FakeProcess {
  const emitter = new EventEmitter() as FakeProcess;
  emitter.argv = argv;
  emitter.env = {};
  emitter.exit = vi.fn();
  emitter.stdin = { fd: 0 };
  return emitter;
}

async function waitForAssertion(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe('processErrorReporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProcessErrorReportingForTests();
    loadConfigMock.mockResolvedValue({
      provider: 'openrouter',
      autoReport: { enabled: true },
      configPath: '/tmp/autohand.json',
      isNewConfig: false,
    });
    reportErrorMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (globalThis as { __autohandLastError?: unknown }).__autohandLastError;
  });

  it('reports unhandled rejections with argv-derived config and client metadata', async () => {
    const fakeProcess = createFakeProcess([
      'node',
      'autohand',
      '--mode',
      'acp',
      '--config',
      '/tmp/custom.json',
    ]);
    const logError = vi.fn();

    installProcessErrorHandlers({ processRef: fakeProcess, logError });
    fakeProcess.emit('unhandledRejection', new Error('boom'), Promise.resolve());

    await waitForAssertion(() => {
      expect(loadConfigMock).toHaveBeenCalledWith('/tmp/custom.json');
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
    });

    const [error, context] = reportErrorMock.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
    expect(context).toMatchObject({
      context: {
        source: 'process',
        handler: 'unhandledRejection',
        clientName: 'acp',
        fatal: false,
        rawType: 'object',
      }
    });
    expect((globalThis as { __autohandLastError?: unknown }).__autohandLastError).toBeInstanceOf(Error);
  });

  it('waits for reporting before exiting on uncaught exceptions', async () => {
    const fakeProcess = createFakeProcess();
    const exitMock = vi.fn();
    const logError = vi.fn();

    installProcessErrorHandlers({
      processRef: fakeProcess,
      exit: exitMock,
      logError,
    });
    fakeProcess.emit('uncaughtException', new TypeError('fatal crash'));

    await waitForAssertion(() => {
      expect(reportErrorMock).toHaveBeenCalledTimes(1);
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    const [error, context] = reportErrorMock.mock.calls[0];
    expect((error as Error).name).toBe('TypeError');
    expect(context).toMatchObject({
      context: {
        handler: 'uncaughtException',
        fatal: true,
        clientName: 'cli',
      }
    });
  });

  it('ignores readline-close rejections and duplicate installs on the same process', async () => {
    const fakeProcess = createFakeProcess();

    installProcessErrorHandlers({ processRef: fakeProcess });
    installProcessErrorHandlers({ processRef: fakeProcess });
    fakeProcess.emit('unhandledRejection', { code: 'ERR_USE_AFTER_CLOSE' }, Promise.resolve());

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it('ignores EIO read errors on stdin (fd 0) as uncaught exceptions', async () => {
    const fakeProcess = createFakeProcess();
    const logError = vi.fn();
    const exitMock = vi.fn();

    installProcessErrorHandlers({ processRef: fakeProcess, logError, exit: exitMock });

    const eioError = Object.assign(new Error('EIO'), {
      code: 'EIO',
      syscall: 'read',
      fd: 0,
    });
    fakeProcess.emit('uncaughtException', eioError);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('ignores EIO read errors on non-stdin fds (e.g. Ink modal fd 6)', async () => {
    const fakeProcess = createFakeProcess();
    const logError = vi.fn();
    const exitMock = vi.fn();

    installProcessErrorHandlers({ processRef: fakeProcess, logError, exit: exitMock });

    const eioError = Object.assign(new Error('EIO'), {
      code: 'EIO',
      syscall: 'read',
      fd: 6,
    });
    fakeProcess.emit('uncaughtException', eioError);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('ignores EIO read errors as unhandled rejections regardless of fd', async () => {
    const fakeProcess = createFakeProcess();

    installProcessErrorHandlers({ processRef: fakeProcess });

    const eioError = Object.assign(new Error('EIO'), {
      code: 'EIO',
      syscall: 'read',
      fd: 6,
    });
    fakeProcess.emit('unhandledRejection', eioError, Promise.resolve());

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('ignores EACCES mkdir errors as unhandled rejections', async () => {
    const fakeProcess = createFakeProcess();
    installProcessErrorHandlers({ processRef: fakeProcess });

    const eaccesError = Object.assign(new Error("EACCES: permission denied, mkdir '/storage/68CB-F07A/projects'"), {
      code: 'EACCES',
      syscall: 'mkdir',
    });
    fakeProcess.emit('unhandledRejection', eaccesError, Promise.resolve());

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('ignores EEXIST mkdir errors as unhandled rejections', async () => {
    const fakeProcess = createFakeProcess();
    installProcessErrorHandlers({ processRef: fakeProcess });

    const eexistError = Object.assign(new Error("EEXIST: file already exists, mkdir '~/.autohand/memory'"), {
      code: 'EEXIST',
      syscall: 'mkdir',
    });
    fakeProcess.emit('unhandledRejection', eexistError, Promise.resolve());

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('ignores setRawMode errno errors as uncaught exceptions', async () => {
    const fakeProcess = createFakeProcess();
    const logError = vi.fn();
    const exitMock = vi.fn();
    installProcessErrorHandlers({ processRef: fakeProcess, logError, exit: exitMock });

    const rawModeError = new Error('setRawMode failed with errno: 9');
    fakeProcess.emit('uncaughtException', rawModeError);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('ignores Generator is executing errors as uncaught exceptions', async () => {
    const fakeProcess = createFakeProcess();
    const logError = vi.fn();
    const exitMock = vi.fn();
    installProcessErrorHandlers({ processRef: fakeProcess, logError, exit: exitMock });

    const genError = new TypeError('Generator is executing');
    fakeProcess.emit('uncaughtException', genError);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('ignores node:sqlite resolution errors as unhandled rejections', async () => {
    const fakeProcess = createFakeProcess();
    installProcessErrorHandlers({ processRef: fakeProcess });

    const sqliteError = new Error('Could not resolve: "node:sqlite". Maybe you need to "bun install"?');
    fakeProcess.emit('unhandledRejection', sqliteError, Promise.resolve());

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('falls back to an in-memory config when loading the user config fails', async () => {
    const fakeProcess = createFakeProcess();
    fakeProcess.env.AUTOHAND_API_URL = 'https://api.example.com';
    loadConfigMock.mockRejectedValue(new Error('broken config'));

    await reportProcessError('string failure', {
      handler: 'unhandledRejection',
      processRef: fakeProcess,
      configPath: '/tmp/bad-config.json',
    });

    expect(managerCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        configPath: '/tmp/bad-config.json',
        isNewConfig: false,
        autoReport: { enabled: true },
        api: {
          baseUrl: 'https://api.example.com',
          companySecret: '',
        },
      }),
      '0.8.0',
    );

    const [error, context] = reportErrorMock.mock.calls[0];
    expect((error as Error).message).toBe('string failure');
    expect((error as Error).name).toBe('NonErrorProcessFault');
    expect(context).toMatchObject({
      context: {
        handler: 'unhandledRejection',
        clientName: 'cli',
      }
    });
  });
});
