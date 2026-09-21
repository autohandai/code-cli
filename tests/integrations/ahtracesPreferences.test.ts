import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';

const { loadConfigMock, saveConfigMock, reconcileAhTracesMock, runAhTracesProcessMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  saveConfigMock: vi.fn(),
  reconcileAhTracesMock: vi.fn(),
  runAhTracesProcessMock: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
}));

vi.mock('../../src/integrations/ahtraces/client.js', () => ({
  reconcileAhTraces: reconcileAhTracesMock,
  runAhTracesProcess: runAhTracesProcessMock,
}));

const { runAhTracesCommand } = await import('../../src/integrations/ahtraces/commands.js');

function config(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    isNewConfig: false,
    ...overrides,
  } as LoadedConfig;
}

describe('ahtraces monitoring preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue(config());
    saveConfigMock.mockResolvedValue(undefined);
    reconcileAhTracesMock.mockResolvedValue({ status: 'running', pid: 123, restarted: false });
    runAhTracesProcessMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('enables local monitoring and metadata sync before starting the daemon', async () => {
    await expect(runAhTracesCommand(['on', '--config', '/tmp/autohand-config.json'])).resolves.toBe(0);

    expect(saveConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      traces: expect.objectContaining({
        enabled: true,
        cloudSync: true,
        contentMode: 'metadata',
      }),
    }));
    expect(reconcileAhTracesMock).toHaveBeenCalledWith(
      expect.objectContaining({ traces: expect.objectContaining({ enabled: true }) }),
      { strict: true },
    );
    expect(saveConfigMock.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileAhTracesMock.mock.invocationCallOrder[0],
    );
  });

  it('withdraws cloud sync consent before stopping the daemon', async () => {
    loadConfigMock.mockResolvedValue(config({
      traces: { enabled: true, cloudSync: true, contentMode: 'full', discoveryMap: true },
    }));
    reconcileAhTracesMock.mockResolvedValue({ status: 'disabled' });

    await expect(runAhTracesCommand(['off'])).resolves.toBe(0);

    expect(saveConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      traces: expect.objectContaining({
        enabled: false,
        cloudSync: false,
        contentMode: 'metadata',
      }),
    }));
    expect(reconcileAhTracesMock).toHaveBeenCalledWith(
      expect.objectContaining({ traces: expect.objectContaining({ enabled: false }) }),
      { strict: true },
    );
  });

  it('delegates status and stop commands to the installed component', async () => {
    runAhTracesProcessMock.mockResolvedValue({
      exitCode: 0,
      stdout: '{"running":true,"pid":123}\n',
      stderr: '',
    });

    await expect(runAhTracesCommand(['status', '--json'])).resolves.toBe(0);

    expect(runAhTracesProcessMock).toHaveBeenCalledWith(['status', '--json'], {});
    expect(loadConfigMock).not.toHaveBeenCalled();
  });
});
