import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProgramStatus, type ProgramStatusReport } from '../../src/core/agent/AgentProgramStatus.js';
import { AUTH_CONFIG } from '../../src/constants.js';
import type { LoadedConfig } from '../../src/types.js';

const auth = vi.hoisted(() => ({ initiateDeviceAuth: vi.fn(), pollDeviceAuth: vi.fn() }));
vi.mock('../../src/auth/index.js', () => ({ getAuthClient: () => auth }));
import { login } from '../../src/commands/login.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('AUTOHAND_NO_BROWSER', '1');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  auth.initiateDeviceAuth.mockResolvedValue({ success: true, deviceCode: 'test-device', userCode: 'test-code', interval: 1, schemaVersion: 2 });
  auth.pollDeviceAuth.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function runLogin() {
  const reports: ProgramStatusReport[] = [];
  const status = new AgentProgramStatus({ id: 'test-login', enabled: false, write: vi.fn(), onChange: report => reports.push(report) });
  const baseline = vi.getTimerCount();
  const operation = status.run(() => login({ config: { configPath: '/unused' } as LoadedConfig, restoreSync: false }));
  await vi.advanceTimersByTimeAsync(AUTH_CONFIG.authTimeout + 1_000);
  expect(await operation).toBeNull();
  expect(vi.getTimerCount()).toBe(baseline);
  return reports;
}

describe('login program status outcomes', () => {
  it('reports initiation failure as error without changing the login return contract', async () => {
    auth.initiateDeviceAuth.mockResolvedValue({ success: false, error: 'auth service unavailable' });
    expect((await runLogin()).map(report => report.state)).toEqual(['working', 'blocked', 'error']);
  });

  it('reports an expired device code as error', async () => {
    auth.pollDeviceAuth.mockResolvedValue({ status: 'expired' });
    expect((await runLogin()).map(report => report.state)).toEqual(['working', 'blocked', 'error']);
  });

  it('reports cancelled authorization as idle', async () => {
    auth.pollDeviceAuth.mockResolvedValue({ status: 'cancelled' });
    expect((await runLogin()).map(report => report.state)).toEqual(['working', 'blocked', 'idle']);
  });

  it('reports an authorization timeout as error and releases the last poll timer', async () => {
    auth.pollDeviceAuth.mockResolvedValue({ status: 'pending' });
    expect((await runLogin()).map(report => report.state)).toEqual(['working', 'blocked', 'error']);
  });
});
