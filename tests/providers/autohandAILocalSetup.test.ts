/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

var mockRunCommand = vi.fn();
var mockIsMLXSupported = vi.fn();
var mockGetTotalMemoryGb = vi.fn();
var mockGetFreeMemoryGb = vi.fn();
var mockGetAvailableMemoryGb = vi.fn();

vi.mock('../../src/actions/command.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../src/utils/platform.js', () => ({
  isMLXSupported: mockIsMLXSupported,
  getTotalMemoryGb: mockGetTotalMemoryGb,
  getFreeMemoryGb: mockGetFreeMemoryGb,
  getAvailableMemoryGb: mockGetAvailableMemoryGb,
}));

const {
  AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS,
  ensureAutohandAILocalRuntime,
  probeAutohandAILocalEnvironment,
  recommendAutohandAILocalModels,
  renderAutohandAISetupProgress,
} = await import('../../src/providers/autohandAILocalSetup.js');

describe('autohandai local setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMLXSupported.mockReturnValue(true);
    mockGetTotalMemoryGb.mockReturnValue(64);
    mockGetFreeMemoryGb.mockReturnValue(48);
    mockGetAvailableMemoryGb.mockReturnValue(48);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
  });

  it('reports unsupported when Local is selected off Apple Silicon', async () => {
    mockIsMLXSupported.mockReturnValue(false);

    const probe = await probeAutohandAILocalEnvironment('/repo');

    expect(probe.supported).toBe(false);
    expect(probe.mlxServerInstalled).toBe(false);
    expect(probe.llmfitInstalled).toBe(false);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('detects missing mlx server and llmfit on Apple Silicon', async () => {
    mockRunCommand.mockResolvedValue({ code: 1, stdout: '', stderr: '' });

    const probe = await probeAutohandAILocalEnvironment('/repo');

    expect(probe.supported).toBe(true);
    expect(probe.mlxServerInstalled).toBe(false);
    expect(probe.llmfitInstalled).toBe(false);
    expect(probe.running).toBe(false);
    expect(probe.installPlan?.mlxServer.label).toContain('mlx-lm');
    expect(probe.installPlan?.llmfit.label).toContain('llmfit');
  });

  it('flags an outdated mlx-lm install for reinstall to the pinned version', async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/opt/homebrew/bin/tool\n', stderr: '' };
      if (cmd === 'uv' && args[0] === 'tool' && args[1] === 'list') {
        return { code: 0, stdout: 'mlx-lm v0.20.0\nsome-other-tool v1.0.0\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const probe = await probeAutohandAILocalEnvironment('/repo');

    // Present but stale → treated as not installed so it gets reinstalled at the pin.
    expect(probe.mlxServerInstalled).toBe(false);
    expect(probe.installPlan?.mlxServer.args.join(' ')).toMatch(/mlx-lm==\d+\.\d+\.\d+/);
  });

  it('accepts an mlx-lm install that already matches the pinned version', async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/opt/homebrew/bin/tool\n', stderr: '' };
      if (cmd === 'uv' && args[0] === 'tool' && args[1] === 'list') {
        return { code: 0, stdout: 'mlx-lm v0.31.3\n', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const probe = await probeAutohandAILocalEnvironment('/repo');

    expect(probe.mlxServerInstalled).toBe(true);
  });

  it('pins the mlx-lm version in the install plan for deterministic installs', async () => {
    // uv is available; mlx server and llmfit are missing.
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'uv') return { code: 0, stdout: '/opt/homebrew/bin/uv\n', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    });

    const probe = await probeAutohandAILocalEnvironment('/repo');
    const mlx = probe.installPlan?.mlxServer;

    expect(mlx).toBeDefined();
    // A pinned version keeps every install reproducible instead of drifting to
    // whatever mlx-lm happens to be latest.
    expect(mlx!.args.join(' ')).toMatch(/mlx-lm==\d+\.\d+\.\d+/);
  });

  it('uses llmfit recommendations and keeps coding-focused MLX models only', async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'llmfit' && args[0] === 'recommend') {
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            models: [
              {
                name: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
                score: 0.91,
                parameter_count: '7B',
                estimated_tps: 42,
                mlx_sources: [{ repo: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit' }],
              },
              {
                name: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
                score: 0.88,
                parameter_count: '3B',
                estimated_tps: 61,
                mlx_sources: [{ repo: 'mlx-community/Llama-3.2-3B-Instruct-4bit' }],
              },
            ],
          }),
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const models = await recommendAutohandAILocalModels('/repo');

    expect(models.map((model) => model.id)).toEqual([
      'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    ]);
    expect(models[0]?.source).toBe('llmfit');
  });

  it('falls back to curated coding models when llmfit cannot recommend', async () => {
    mockRunCommand.mockResolvedValue({ code: 1, stdout: '', stderr: 'no recommendations' });

    const models = await recommendAutohandAILocalModels('/repo');

    expect(models).toEqual(AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS);
  });

  it('installs missing local runtime pieces and starts mlx server, which auto-downloads the model', async () => {
    const progress: string[] = [];
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'mlx_lm.server') return { code: 1, stdout: '', stderr: '' };
      if (cmd === 'which' && args[0] === 'llmfit') return { code: 1, stdout: '', stderr: '' };
      if (cmd === 'which' && args[0] === 'uv') return { code: 0, stdout: '/opt/homebrew/bin/uv\n', stderr: '' };
      if (cmd === 'which' && args[0] === 'curl') return { code: 0, stdout: '/usr/bin/curl\n', stderr: '' };
      if (cmd === 'uv') return { code: 0, stdout: 'installed mlx-lm', stderr: '' };
      if (cmd === 'sh') return { code: 0, stdout: 'installed llmfit', stderr: '' };
      if (cmd === 'mlx_lm.server') return { code: null, stdout: '', stderr: '', backgroundPid: 1234 };
      return { code: 0, stdout: '', stderr: '' };
    });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('not running')) // probe during dependency check
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }) // model not yet served
      .mockRejectedValueOnce(new Error('not running')) // running-server-with-other-model check
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!.id }] }),
      }) as unknown as typeof fetch;

    const result = await ensureAutohandAILocalRuntime(
      {
        cwd: '/repo',
        model: AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!,
        port: 8080,
      },
      (event) => progress.push(renderAutohandAISetupProgress(event)),
    );

    expect(result.ok).toBe(true);
    expect(result.serverCommand).toContain('mlx_lm.server');
    expect(result.baseUrl).toBe('http://127.0.0.1:8080');
    expect(progress.some((line) => line.includes('Installing MLX server'))).toBe(true);
    expect(progress.some((line) => line.includes('Downloading'))).toBe(true);
    expect(progress.some((line) => line.includes('Starting MLX server'))).toBe(true);
    // The model is fetched by mlx_lm.server on load, never by llmfit (GGUF-only).
    expect(
      mockRunCommand.mock.calls.some(
        ([cmd, args]: [string, string[]]) => cmd === 'llmfit' && args[0] === 'download',
      ),
    ).toBe(false);
    expect(mockRunCommand).toHaveBeenCalledWith(
      'mlx_lm.server',
      ['--model', AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!.id, '--port', '8080'],
      '/repo',
      expect.objectContaining({ background: true }),
    );
  });

  it('installs llmfit without sudo by requesting a user-local install', async () => {
    // curl is available; llmfit and the mlx server are both missing.
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'curl') return { code: 0, stdout: '/usr/bin/curl\n', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    });

    const probe = await probeAutohandAILocalEnvironment('/repo');
    const llmfit = probe.installPlan?.llmfit;

    expect(llmfit).toBeDefined();
    const script = llmfit!.args.join(' ');
    // The piped installer must request the sudo-free ~/.local/bin install so the
    // wizard never blocks on a sudo password prompt it cannot capture under Ink.
    expect(script).toContain('--local');
    expect(`${llmfit!.command} ${script} ${llmfit!.label}`).not.toContain('sudo');
  });

  it('runs llmfit with the user-local bin directory on PATH so a sudo-free install resolves', async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'llmfit' && args[0] === 'recommend') {
        return { code: 0, stderr: '', stdout: JSON.stringify({ models: [] }) };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    await recommendAutohandAILocalModels('/repo');

    const recommendCall = mockRunCommand.mock.calls.find(
      ([cmd, args]: [string, string[]]) => cmd === 'llmfit' && args[0] === 'recommend',
    );
    expect(recommendCall).toBeDefined();
    const options = recommendCall![3] as { env?: Record<string, string> };
    expect(options.env?.PATH ?? '').toContain('.local/bin');
  });

  it('captures the llmfit memory estimate for recommended models', async () => {
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'llmfit' && args[0] === 'recommend') {
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            models: [
              {
                name: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
                memory_required_gb: 8.5,
                mlx_sources: [{ repo: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit' }],
              },
            ],
          }),
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const models = await recommendAutohandAILocalModels('/repo');

    expect(models[0]?.estimatedMemoryGb).toBe(8.5);
  });

  it('refuses to start the MLX server when the model needs more memory than the Mac has', async () => {
    const big = {
      ...AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!,
      id: 'mlx-community/Huge-70B-4bit',
      label: 'Huge 70B',
      estimatedMemoryGb: 40,
    };
    mockGetAvailableMemoryGb.mockReturnValue(12); // only 12 GB free right now
    mockRunCommand.mockImplementation(async (cmd: string) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'mlx_lm.server') return { code: null, stdout: '', stderr: '', backgroundPid: 99 };
      return { code: 0, stdout: '', stderr: '' };
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('not running')) as unknown as typeof fetch;

    const result = await ensureAutohandAILocalRuntime({ cwd: '/repo', model: big, port: 8080 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/memory/i);
    // Must fail fast without ever launching the server.
    const startedServer = mockRunCommand.mock.calls.some(([cmd]: [string]) => cmd === 'mlx_lm.server');
    expect(startedServer).toBe(false);
  });

  it('never uses llmfit to fetch MLX models and lets mlx_lm.server auto-download on load', async () => {
    const selected = AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!;
    mockRunCommand.mockImplementation(async (cmd: string, _args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'mlx_lm.server') return { code: null, stdout: '', stderr: '', backgroundPid: 4321 };
      return { code: 0, stdout: '', stderr: '' };
    });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('not running')) // probe during dependency check
      .mockRejectedValueOnce(new Error('not running')) // serverHasModel before start
      .mockRejectedValueOnce(new Error('not running')) // running-server-with-other-model check
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: selected.id }] }),
      }) as unknown as typeof fetch;

    const result = await ensureAutohandAILocalRuntime({ cwd: '/repo', model: selected, port: 8080 });

    expect(result.ok).toBe(true);
    // llmfit is a GGUF/llama.cpp tool and rejects `--runtime`; it must never be asked
    // to download an MLX model. mlx_lm.server fetches the weights on first load instead.
    const usedLlmfitDownload = mockRunCommand.mock.calls.some(
      ([cmd, args]: [string, string[]]) => cmd === 'llmfit' && args[0] === 'download',
    );
    expect(usedLlmfitDownload).toBe(false);
    expect(mockRunCommand).toHaveBeenCalledWith(
      'mlx_lm.server',
      expect.arrayContaining(['--model', selected.id]),
      '/repo',
      expect.objectContaining({ background: true }),
    );
  });

  it('starts the selected model on a new port when an existing MLX server has a different model', async () => {
    const selected = AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS[0]!;
    mockRunCommand.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { code: 0, stdout: '/bin/tool\n', stderr: '' };
      if (cmd === 'llmfit' && args[0] === 'download') return { code: 0, stdout: 'downloaded', stderr: '' };
      if (cmd === 'mlx_lm.server') return { code: null, stdout: '', stderr: '', backgroundPid: 5678 };
      return { code: 0, stdout: '', stderr: '' };
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'old-model' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'old-model' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'old-model' }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: selected.id }] }) }) as unknown as typeof fetch;

    const result = await ensureAutohandAILocalRuntime({
      cwd: '/repo',
      model: selected,
      port: 8080,
    });

    expect(result.ok).toBe(true);
    expect(result.baseUrl).toBe('http://127.0.0.1:8081');
    expect(result.port).toBe(8081);
    expect(mockRunCommand).toHaveBeenCalledWith(
      'mlx_lm.server',
      ['--model', selected.id, '--port', '8081'],
      '/repo',
      expect.objectContaining({ background: true }),
    );
  });
});
