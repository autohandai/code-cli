/** @license Apache-2.0 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import {
  createAhTracesSettings,
  reconcileAhTraces,
  resolveAhTracesExecutable,
  runAhTracesProcess,
  shouldReconcileAhTracesAtStartup,
  type AhTracesRunner,
} from '../../src/integrations/ahtraces/client.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function config(enabled: boolean): LoadedConfig {
  return {
    configPath: '/tmp/config.json',
    auth: { token: 'ahc_secret-account-token' },
    api: { baseUrl: 'https://api.autohand.ai/' },
    traces: {
      consentVersion: 1,
      enabled,
      cloudSync: enabled,
      contentMode: 'metadata',
      discoveryMap: enabled,
      pollIntervalMs: 60_000,
    },
  } as LoadedConfig;
}

describe('ahtraces component client', () => {
  it('does not start persistent integrations in bare or simple mode', () => {
    expect(shouldReconcileAhTracesAtStartup(true, {})).toBe(false);
    expect(shouldReconcileAhTracesAtStartup(false, { AUTOHAND_CODE_SIMPLE: '1' })).toBe(false);
    expect(shouldReconcileAhTracesAtStartup(false, {})).toBe(true);
  });

  it('locates the independently installed sibling binary', () => {
    expect(resolveAhTracesExecutable({ AUTOHAND_AHTRACES_EXECUTABLE: '/opt/private/ahtraces' }))
      .toBe('/opt/private/ahtraces');
    expect(resolveAhTracesExecutable({}, '/opt/autohand/autohand', 'linux'))
      .toBe(path.join('/opt/autohand', 'ahtraces'));
    expect(resolveAhTracesExecutable({}, 'C:\\Autohand\\autohand.exe', 'win32'))
      .toBe('C:\\Autohand\\ahtraces.exe');
  });

  it('creates a versioned settings snapshot and sends credentials only through stdin', async () => {
    const run = vi.fn<AhTracesRunner>(async () => ({
      exitCode: 0,
      stdout: '{"status":"running","pid":123,"restarted":false}\n',
      stderr: '',
    }));

    await expect(reconcileAhTraces(config(true), {
      run,
      deviceId: 'device-123',
      hasRuntimeArtifacts: () => true,
      strict: true,
    })).resolves.toEqual({ status: 'running', pid: 123, restarted: false });

    const [args, invocation] = run.mock.calls[0];
    expect(args).toEqual(['reconcile', '--json']);
    expect(args.join(' ')).not.toContain('ahc_secret-account-token');
    expect(JSON.parse(invocation.input ?? '')).toEqual({
      schemaVersion: 1,
      consentVersion: 1,
      enabled: true,
      cloudSync: true,
      contentMode: 'metadata',
      discoveryMap: true,
      pollIntervalMs: 60_000,
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'ahc_secret-account-token',
      deviceId: 'device-123',
    });
  });

  it('prefers the trace-specific API endpoint over shared API and environment defaults', () => {
    expect(createAhTracesSettings({
      ...config(true),
      api: { baseUrl: 'https://shared-api.autohand.ai/' },
      traces: {
        ...config(true).traces,
        apiBaseUrl: 'http://localhost:8787/traces/',
      },
    }, 'device-123', {
      AUTOHAND_API_URL: 'https://environment-api.autohand.ai/',
    })).toMatchObject({
      apiBaseUrl: 'http://localhost:8787/traces',
    });
  });

  it('executes the component without a shell and bounds the settings channel', async () => {
    vi.stubEnv('AUTOHAND_AHTRACES_EXECUTABLE', process.execPath);
    const result = await runAhTracesProcess([
      '-e',
      "let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => process.stdout.write(input.toUpperCase()));",
    ], { input: 'settings over stdin' });

    expect(result).toEqual({ exitCode: 0, stdout: 'SETTINGS OVER STDIN', stderr: '' });
    await expect(runAhTracesProcess([], { input: 'x'.repeat(65 * 1024) }))
      .rejects.toThrow('input exceeded');
  });

  it('forwards harness locations without exposing unrelated process secrets', async () => {
    const configuredEnvironment = {
      CLAUDE_CONFIG_DIR: '/private/claude',
      CODEX_HOME: '/private/codex',
      TRACES_CURSOR_GLOBAL_DB: '/private/cursor/state.vscdb',
      TRACES_OPENCODE2_DB: '/private/opencode/current.db',
      TRACES_OPENCODE_DB: '/private/opencode/legacy.db',
      OPENCODE_DB: '/private/opencode/fallback.db',
      AUTOHAND_OPENCODE2_BIN: '/private/bin/opencode',
      TRACES_OPENCODE2_BIN: '/private/bin/opencode-fallback',
      CLINE_DATA_DIR: '/private/cline',
      CLINE_DIR: '/private/cline-home',
      OPENCLAW_STATE_DIR: '/private/openclaw',
      HERMES_HOME: '~/${HERMES_PROFILE_ROOT}/coder',
      KIMI_CODE_HOME: '/private/kimi',
      PRIME_AGENT_SESSION_DIR: '~/${PRIME_PROFILE_ROOT}/sessions',
      PRIME_AGENT_CODING_AGENT_SESSION_DIR: '/private/prime/legacy-sessions',
      PRIME_AGENT_CODING_AGENT_DIR: '/private/prime/agent',
      DSH_HOME: '/private/deepseek',
    } as const;
    const forwardedEnvironment = {
      ...configuredEnvironment,
      HERMES_HOME: '~/hermes-profiles/coder',
      PRIME_AGENT_SESSION_DIR: '~/.prime/custom/sessions',
    };
    vi.stubEnv('AUTOHAND_AHTRACES_EXECUTABLE', process.execPath);
    for (const [key, value] of Object.entries(configuredEnvironment)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv('HERMES_PROFILE_ROOT', 'hermes-profiles');
    vi.stubEnv('PRIME_PROFILE_ROOT', '.prime/custom');
    vi.stubEnv('OPENAI_API_KEY', 'must-not-reach-ahtraces');
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-reach-ahtraces');
    vi.stubEnv('AUTOHAND_API_KEY', 'must-travel-only-through-stdin');

    const keys = Object.keys(forwardedEnvironment);
    const result = await runAhTracesProcess([
      '-e',
      `process.stdout.write(JSON.stringify({ forwarded: Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]])), blocked: { openai: process.env.OPENAI_API_KEY ?? null, anthropic: process.env.ANTHROPIC_API_KEY ?? null, autohand: process.env.AUTOHAND_API_KEY ?? null, hermesReference: process.env.HERMES_PROFILE_ROOT ?? null, primeReference: process.env.PRIME_PROFILE_ROOT ?? null } }))`,
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      forwarded: forwardedEnvironment,
      blocked: {
        openai: null,
        anthropic: null,
        autohand: null,
        hermesReference: null,
        primeReference: null,
      },
    });
  });

  it('forces legacy unconsented settings off before handing them to the component', () => {
    expect(createAhTracesSettings({
      ...config(true),
      traces: { enabled: true, cloudSync: true },
    }, 'device-123')).toMatchObject({
      consentVersion: 1,
      enabled: false,
      cloudSync: false,
      discoveryMap: false,
    });
  });

  it('skips a disabled component with no runtime artifacts', async () => {
    const run = vi.fn<AhTracesRunner>();
    await expect(reconcileAhTraces(config(false), {
      run,
      deviceId: 'device-123',
      hasRuntimeArtifacts: () => false,
    })).resolves.toEqual({ status: 'disabled' });
    expect(run).not.toHaveBeenCalled();
  });

  it('contains startup failures and surfaces explicit settings failures', async () => {
    const run = vi.fn<AhTracesRunner>(async () => {
      throw new Error('missing component');
    });
    await expect(reconcileAhTraces(config(true), { run, deviceId: 'device-123' }))
      .resolves.toEqual({ status: 'error', code: 'unavailable' });
    await expect(reconcileAhTraces(config(true), { run, deviceId: 'device-123', strict: true }))
      .rejects.toThrow('missing component');
  });
});
