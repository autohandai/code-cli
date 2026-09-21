import { describe, expect, it, vi } from 'vitest';
import {
  isMatchingLiveState,
  parseAhTracesArguments,
  stopAuthenticatedDaemon,
} from '../../src/ahtraces.js';
import type { AhTracesDaemonState } from '../../src/traces/supervisor/AhTracesSupervisor.js';

const daemonState: AhTracesDaemonState = {
  pid: 123,
  instanceId: 'instance-1',
  version: '1.0.0',
  protocolVersion: 1,
  socketPath: '/tmp/ahtraces.sock',
  controlToken: 'control-token-1234567890',
  startedAt: '2026-09-18T00:00:00.000Z',
};

describe('ahtraces command arguments', () => {
  it('accepts the authenticated internal daemon launch contract', () => {
    expect(parseAhTracesArguments(['--daemon', '--instance-id', 'instance-1', '--config', '/tmp/config.json']))
      .toEqual({ command: 'daemon', instanceId: 'instance-1', configPath: '/tmp/config.json', json: false });
  });

  it.each([
    [[], 'help'],
    [['--help'], 'help'],
    [['--version'], 'version'],
    [['status'], 'status'],
    [['on'], 'on'],
    [['off'], 'off'],
    [['stop', '--json'], 'stop'],
  ] as const)('maps %j to %s', (argv, command) => {
    expect(parseAhTracesArguments([...argv])).toMatchObject({ command });
  });

  it('rejects a daemon launch without a unique instance identity', () => {
    expect(() => parseAhTracesArguments(['--daemon'])).toThrow('--instance-id');
  });

  it('rejects unsupported public commands', () => {
    expect(() => parseAhTracesArguments(['upload-everything'])).toThrow('Unknown ahtraces command');
  });

  it('accepts live state only when both the instance identity and control token match', () => {
    expect(isMatchingLiveState(daemonState, { ...daemonState })).toBe(true);
    expect(isMatchingLiveState(daemonState, { ...daemonState, instanceId: 'replacement' })).toBe(false);
    expect(isMatchingLiveState(daemonState, { ...daemonState, controlToken: 'replacement-token-123456' })).toBe(false);
  });

  it('waits for shutdown and force-terminates only after the graceful deadline', async () => {
    const host = {
      request: vi.fn().mockResolvedValue({ ok: true }),
      waitForTermination: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      forceTerminate: vi.fn().mockResolvedValue(undefined),
    };

    await stopAuthenticatedDaemon(host, daemonState);

    expect(host.request).toHaveBeenCalledWith(daemonState, { type: 'shutdown' });
    expect(host.waitForTermination).toHaveBeenCalledTimes(2);
    expect(host.waitForTermination).toHaveBeenCalledWith(daemonState);
    expect(host.forceTerminate).toHaveBeenCalledWith(daemonState);
  });
});
