/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../actions/command.js';
import { getAvailableMemoryGb, isMLXSupported } from '../utils/platform.js';

export interface AutohandAILocalModel {
  id: string;
  label: string;
  description: string;
  estimatedMemoryGb?: number;
  parameterCount?: string;
  estimatedTokensPerSecond?: number;
  score?: number;
  source: 'llmfit' | 'curated';
}

export interface AutohandAILocalInstallCommand {
  command: string;
  args: string[];
  label: string;
  shell?: boolean;
}

export interface AutohandAILocalInstallPlan {
  mlxServer: AutohandAILocalInstallCommand;
  llmfit: AutohandAILocalInstallCommand;
}

export interface AutohandAILocalProbeResult {
  supported: boolean;
  mlxServerInstalled: boolean;
  llmfitInstalled: boolean;
  running: boolean;
  baseUrl: string;
  port: number;
  installPlan?: AutohandAILocalInstallPlan;
}

export type AutohandAISetupPhase =
  | 'probe'
  | 'install-mlx'
  | 'install-llmfit'
  | 'recommend'
  | 'download'
  | 'start-server'
  | 'ready';

export interface AutohandAISetupProgress {
  phase: AutohandAISetupPhase;
  label: string;
  progress: number;
}

export interface EnsureAutohandAILocalRuntimeOptions {
  cwd: string;
  model: AutohandAILocalModel;
  port?: number;
  baseUrl?: string;
}

export interface EnsureAutohandAILocalRuntimeResult {
  ok: boolean;
  model: AutohandAILocalModel;
  baseUrl: string;
  port: number;
  serverCommand?: string;
  error?: string;
}

export interface EnsureAutohandAILocalDependenciesResult {
  ok: boolean;
  probe: AutohandAILocalProbeResult;
  error?: string;
}

const DEFAULT_LOCAL_PORT = 8080;
const LOCAL_PROBE_TIMEOUT_MS = 3_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// mlx_lm.server downloads the model from HuggingFace the first time it loads, so the
// readiness wait has to tolerate a multi-gigabyte download, not just process startup.
const MODEL_LOAD_TIMEOUT_MS = 30 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 120_000;
// Pin the MLX runtime so every local install is reproducible instead of drifting
// to whatever mlx-lm is latest. Bump deliberately after validating a new release.
const MLX_LM_PINNED_VERSION = '0.31.3';
const MLX_LM_SPEC = `mlx-lm==${MLX_LM_PINNED_VERSION}`;
const CODING_MODEL_PATTERN = /(code|coder|coding|codestral|devstral|starcoder|qwen|deepseek)/i;

export const AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS: AutohandAILocalModel[] = [
  {
    id: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    label: 'Qwen2.5 Coder 7B',
    description: 'Fast local coding model for Apple Silicon Macs',
    estimatedMemoryGb: 8,
    parameterCount: '7B',
    source: 'curated',
  },
  {
    id: 'mlx-community/Qwen2.5-Coder-14B-Instruct-4bit',
    label: 'Qwen2.5 Coder 14B',
    description: 'Higher-quality local coding model for larger Apple Silicon Macs',
    estimatedMemoryGb: 16,
    parameterCount: '14B',
    source: 'curated',
  },
  {
    id: 'mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit',
    label: 'DeepSeek Coder V2 Lite',
    description: 'Balanced local coding assistant for code review and edits',
    estimatedMemoryGb: 10,
    parameterCount: '16B MoE',
    source: 'curated',
  },
];

/**
 * Build the environment for local-runtime commands so binaries installed to the
 * user-local bin directory (`~/.local/bin`) are resolvable. The llmfit installer
 * runs with `--local` to avoid sudo, which lands the binary there even when the
 * spawned (non-login) shell PATH would otherwise miss it.
 */
function localRuntimeEnv(): Record<string, string> {
  const binDir = join(homedir(), '.local', 'bin');
  const segments = (process.env.PATH ?? '').split(':').filter(Boolean);
  if (!segments.includes(binDir)) {
    segments.unshift(binDir);
  }
  return { PATH: segments.join(':') };
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  const lookup = process.platform === 'win32'
    ? { command: 'where', args: [command] }
    : { command: 'which', args: [command] };

  try {
    const result = await runCommand(lookup.command, lookup.args, cwd, {
      timeout: 5000,
      env: localRuntimeEnv(),
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

/** Extract an mlx-lm version from `uv tool list`, `pipx list`, or `pip show` output. */
function parseMlxLmVersion(output: string): string | undefined {
  // "mlx-lm v0.31.3" (uv) or "mlx-lm 0.31.3" (pipx).
  const direct = output.match(/mlx-lm[\s=v:]+(\d+\.\d+\.\d+)/i);
  if (direct) return direct[1];
  // "Version: 0.31.3" (pip show mlx-lm).
  return output.match(/^Version:\s*(\d+\.\d+\.\d+)/im)?.[1];
}

/**
 * Best-effort read of the installed mlx-lm version across the install methods we
 * support. Returns undefined when it cannot be determined (so callers can avoid
 * churning a working install).
 */
async function getInstalledMlxLmVersion(cwd: string): Promise<string | undefined> {
  const probes: ReadonlyArray<{ command: string; args: string[] }> = [
    { command: 'uv', args: ['tool', 'list'] },
    { command: 'pipx', args: ['list', '--short'] },
    { command: 'python3', args: ['-m', 'pip', 'show', 'mlx-lm'] },
  ];

  for (const probe of probes) {
    if (!(await commandExists(probe.command, cwd))) continue;
    try {
      const result = await runCommand(probe.command, probe.args, cwd, {
        timeout: 10_000,
        env: localRuntimeEnv(),
      });
      if (result.code !== 0) continue;
      const version = parseMlxLmVersion(result.stdout);
      if (version) return version;
    } catch {
      // Try the next probe.
    }
  }

  return undefined;
}

async function getMlxInstallCommand(cwd: string): Promise<AutohandAILocalInstallCommand> {
  if (await commandExists('uv', cwd)) {
    return {
      command: 'uv',
      args: ['tool', 'install', MLX_LM_SPEC],
      label: `uv tool install ${MLX_LM_SPEC}`,
    };
  }

  if (await commandExists('pipx', cwd)) {
    return {
      command: 'pipx',
      args: ['install', MLX_LM_SPEC],
      label: `pipx install ${MLX_LM_SPEC}`,
    };
  }

  return {
    command: 'python3',
    args: ['-m', 'pip', 'install', '--user', MLX_LM_SPEC],
    label: `python3 -m pip install --user ${MLX_LM_SPEC}`,
  };
}

async function getLlmfitInstallCommand(cwd: string): Promise<AutohandAILocalInstallCommand> {
  if (await commandExists('curl', cwd)) {
    // `--local` installs to ~/.local/bin without sudo. A sudo password prompt
    // cannot be answered while Ink owns the terminal in raw mode, so the wizard
    // must never trigger one during the install phase.
    const script = 'curl -fsSL https://llmfit.axjns.dev/install.sh | sh -s -- --local';
    return {
      command: 'sh',
      args: ['-c', script],
      label: script,
      shell: false,
    };
  }

  return {
    command: 'python3',
    args: ['-m', 'pip', 'install', '--user', 'llmfit'],
    label: 'python3 -m pip install --user llmfit',
  };
}

function modelLabel(modelId: string): string {
  const last = modelId.split('/').pop() ?? modelId;
  return last
    .replace(/[-_]?4bit/gi, '')
    .replace(/[-_]?instruct/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickModelId(candidate: Record<string, unknown>): string | undefined {
  const direct = [candidate.id, candidate.name, candidate.model]
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  if (direct?.startsWith('mlx-community/')) return direct;

  for (const key of ['mlx_sources', 'mlxSources', 'sources']) {
    const sources = candidate[key];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (typeof source === 'string' && source.startsWith('mlx-community/')) return source;
      if (source && typeof source === 'object') {
        const repo = (source as Record<string, unknown>).repo;
        if (typeof repo === 'string' && repo.startsWith('mlx-community/')) return repo;
      }
    }
  }

  return direct;
}

function parseLlmfitRecommendations(stdout: string): AutohandAILocalModel[] {
  const parsed = JSON.parse(stdout) as { models?: unknown[] } | unknown[];
  const rawModels = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.models)
      ? parsed.models
      : [];

  const seen = new Set<string>();
  const models: AutohandAILocalModel[] = [];

  for (const raw of rawModels) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const id = pickModelId(candidate);
    if (!id || seen.has(id) || !CODING_MODEL_PATTERN.test(id)) continue;

    seen.add(id);
    const score = coerceNumber(candidate.score);
    const estimatedTokensPerSecond = coerceNumber(candidate.estimated_tps ?? candidate.estimatedTokensPerSecond);
    const estimatedMemoryGb = coerceNumber(candidate.memory_required_gb ?? candidate.memoryRequiredGb);
    const parameterCount = typeof candidate.parameter_count === 'string'
      ? candidate.parameter_count
      : typeof candidate.parameterCount === 'string'
        ? candidate.parameterCount
        : undefined;

    models.push({
      id,
      label: modelLabel(id),
      description: [
        parameterCount ? `${parameterCount} coding model` : 'Coding-focused local model',
        estimatedMemoryGb ? `${Math.round(estimatedMemoryGb)} GB` : undefined,
        estimatedTokensPerSecond ? `${estimatedTokensPerSecond} tok/s estimated` : undefined,
        score ? `llmfit score ${score}` : undefined,
      ].filter(Boolean).join(' · '),
      estimatedMemoryGb,
      parameterCount,
      estimatedTokensPerSecond,
      score,
      source: 'llmfit',
    });
  }

  return models;
}

export function renderAutohandAISetupProgress(event: AutohandAISetupProgress): string {
  const width = 18;
  const bounded = Math.min(1, Math.max(0, event.progress));
  const filled = Math.round(bounded * width);
  const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
  return `[${bar}] ${Math.round(bounded * 100).toString().padStart(3, ' ')}% ${event.label}`;
}

export async function probeAutohandAILocalEnvironment(
  cwd: string,
  port = DEFAULT_LOCAL_PORT,
): Promise<AutohandAILocalProbeResult> {
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!isMLXSupported()) {
    return {
      supported: false,
      mlxServerInstalled: false,
      llmfitInstalled: false,
      running: false,
      baseUrl,
      port,
    };
  }

  const [mlxServerBinary, llmfitInstalled, running] = await Promise.all([
    commandExists('mlx_lm.server', cwd),
    commandExists('llmfit', cwd),
    probeAutohandAILocalServer(baseUrl),
  ]);

  // Verify the pinned version, not just presence. Only force a reinstall when we
  // can positively read a mismatching version; if it can't be determined, trust
  // the existing install rather than churning it on every launch.
  let mlxServerInstalled = mlxServerBinary;
  if (mlxServerBinary) {
    const installedVersion = await getInstalledMlxLmVersion(cwd);
    if (installedVersion && installedVersion !== MLX_LM_PINNED_VERSION) {
      mlxServerInstalled = false;
    }
  }

  return {
    supported: true,
    mlxServerInstalled,
    llmfitInstalled,
    running,
    baseUrl,
    port,
    installPlan:
      mlxServerInstalled && llmfitInstalled
        ? undefined
        : {
            mlxServer: await getMlxInstallCommand(cwd),
            llmfit: await getLlmfitInstallCommand(cwd),
          },
  };
}

export async function probeAutohandAILocalServer(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(LOCAL_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function listAutohandAILocalServerModels(baseUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(LOCAL_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = await response.json() as { data?: Array<{ id?: unknown }> };
    return (data.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

async function serverHasModel(baseUrl: string, modelId: string): Promise<boolean> {
  return (await listAutohandAILocalServerModels(baseUrl)).includes(modelId);
}

export async function recommendAutohandAILocalModels(cwd: string): Promise<AutohandAILocalModel[]> {
  try {
    const result = await runCommand(
      'llmfit',
      ['recommend', '--json', '-n', '50', '--runtime', 'mlx'],
      cwd,
      { timeout: 60_000, env: localRuntimeEnv() },
    );

    if (result.code === 0 && result.stdout.trim()) {
      const models = parseLlmfitRecommendations(result.stdout);
      if (models.length > 0) return models;
    }
  } catch {
    // Fall through to curated coding models.
  }

  return AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS;
}

export async function ensureAutohandAILocalDependencies(
  cwd: string,
  onProgress?: (event: AutohandAISetupProgress) => void,
  port = DEFAULT_LOCAL_PORT,
): Promise<EnsureAutohandAILocalDependenciesResult> {
  onProgress?.({ phase: 'probe', label: 'Checking Apple Silicon MLX support', progress: 0.05 });
  const probe = await probeAutohandAILocalEnvironment(cwd, port);
  if (!probe.supported) {
    return {
      ok: false,
      probe,
      error: 'Autohand AI Local requires a Mac with Apple Silicon.',
    };
  }

  if (!probe.mlxServerInstalled && probe.installPlan) {
    onProgress?.({ phase: 'install-mlx', label: 'Installing MLX server', progress: 0.18 });
    const install = await installCommand(probe.installPlan.mlxServer, cwd);
    if (!install.ok) {
      return { ok: false, probe, error: install.output || 'Failed to install MLX server.' };
    }
  }

  if (!probe.llmfitInstalled && probe.installPlan) {
    onProgress?.({ phase: 'install-llmfit', label: 'Installing llmfit hardware/model helper', progress: 0.34 });
    const install = await installCommand(probe.installPlan.llmfit, cwd);
    if (!install.ok) {
      return { ok: false, probe, error: install.output || 'Failed to install llmfit.' };
    }
  }

  return { ok: true, probe };
}

async function installCommand(
  command: AutohandAILocalInstallCommand,
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await runCommand(command.command, command.args, cwd, {
      shell: command.shell,
      timeout: INSTALL_TIMEOUT_MS,
      env: localRuntimeEnv(),
    });
    return {
      ok: result.code === 0,
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

async function startMlxServer(
  model: AutohandAILocalModel,
  cwd: string,
  port: number,
): Promise<{ ok: boolean; command: string; error?: string }> {
  const args = ['--model', model.id, '--port', String(port)];

  try {
    const result = await runCommand('mlx_lm.server', args, cwd, {
      background: true,
      timeout: 0,
      env: localRuntimeEnv(),
    });
    if (result.backgroundPid) {
      return {
        ok: true,
        command: `mlx_lm.server ${args.join(' ')}`,
      };
    }
    return { ok: false, command: `mlx_lm.server ${args.join(' ')}`, error: 'MLX server did not start in the background.' };
  } catch (error) {
    return {
      ok: false,
      command: `mlx_lm.server ${args.join(' ')}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForServerModel(
  baseUrl: string,
  modelId: string,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverHasModel(baseUrl, modelId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

export async function ensureAutohandAILocalRuntime(
  options: EnsureAutohandAILocalRuntimeOptions,
  onProgress?: (event: AutohandAISetupProgress) => void,
): Promise<EnsureAutohandAILocalRuntimeResult> {
  const port = options.port ?? DEFAULT_LOCAL_PORT;
  const baseUrl = options.baseUrl ?? `http://127.0.0.1:${port}`;

  const dependencies = await ensureAutohandAILocalDependencies(options.cwd, onProgress, port);
  if (!dependencies.ok) {
    return { ok: false, model: options.model, baseUrl, port, error: dependencies.error };
  }
  const { probe } = dependencies;

  if (await serverHasModel(baseUrl, options.model.id)) {
    onProgress?.({ phase: 'ready', label: 'Autohand AI Local server is ready', progress: 1 });
    return {
      ok: true,
      model: options.model,
      baseUrl,
      port,
      serverCommand: `mlx_lm.server --model ${options.model.id} --port ${port}`,
    };
  }

  // Guard against loading a model the machine cannot currently hold. MLX loads
  // weights into unified memory, so the model must fit in the memory actually
  // available right now; starting a server for an oversized model would thrash
  // or be killed before it ever serves.
  const requiredGb = options.model.estimatedMemoryGb;
  if (requiredGb) {
    const availableGb = getAvailableMemoryGb();
    if (requiredGb > availableGb) {
      return {
        ok: false,
        model: options.model,
        baseUrl,
        port,
        error: `${options.model.label} needs about ${Math.round(requiredGb)} GB of memory, but only ${Math.round(availableGb)} GB is available right now. Close other apps or choose a smaller local model.`,
      };
    }
  }

  const runningServerHasOtherModel = probe.running || await probeAutohandAILocalServer(baseUrl);
  const serverPort = runningServerHasOtherModel ? port + 1 : port;
  const serverBaseUrl = runningServerHasOtherModel
    ? `http://127.0.0.1:${serverPort}`
    : baseUrl;

  // mlx_lm.server downloads the MLX weights from HuggingFace on first load, so there is
  // no separate download step: llmfit only handles GGUF/llama.cpp models and rejects
  // MLX repos. Surfacing the download phase keeps the wizard progress honest while the
  // server fetches.
  onProgress?.({ phase: 'download', label: `Downloading ${options.model.label}`, progress: 0.58 });
  onProgress?.({ phase: 'start-server', label: 'Starting MLX server', progress: 0.78 });
  const start = await startMlxServer(options.model, options.cwd, serverPort);
  if (!start.ok) {
    return { ok: false, model: options.model, baseUrl: serverBaseUrl, port: serverPort, serverCommand: start.command, error: start.error };
  }

  const ready = await waitForServerModel(serverBaseUrl, options.model.id, MODEL_LOAD_TIMEOUT_MS);
  if (!ready) {
    return {
      ok: false,
      model: options.model,
      baseUrl: serverBaseUrl,
      port: serverPort,
      serverCommand: start.command,
      error: `MLX server did not expose ${options.model.id} at ${serverBaseUrl}.`,
    };
  }

  onProgress?.({ phase: 'ready', label: 'Autohand AI Local server is ready', progress: 1 });
  return {
    ok: true,
    model: options.model,
    baseUrl: serverBaseUrl,
    port: serverPort,
    serverCommand: start.command,
  };
}
