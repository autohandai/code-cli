/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import packageJson from '../../package.json' with { type: 'json' };
import { loadConfig } from '../config.js';
import type { LoadedConfig } from '../types.js';
import { AutoReportManager } from './AutoReportManager.js';

const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const DEFAULT_REPORT_TIMEOUT_MS = 6500;

type ProcessErrorHandler = 'uncaughtException' | 'unhandledRejection';

type ProcessLike = Pick<NodeJS.Process, 'argv' | 'env' | 'exit' | 'stdin' | 'on'>;

interface ProcessErrorContext {
  handler: ProcessErrorHandler;
  processRef?: ProcessLike;
  configPath?: string;
  reportTimeoutMs?: number;
  extraContext?: Record<string, unknown>;
}

interface InstallProcessErrorHandlersOptions {
  processRef?: ProcessLike;
  configPath?: string;
  reportTimeoutMs?: number;
  exit?: (code: number) => void;
  logError?: (...args: unknown[]) => void;
}

let installedProcesses = new WeakSet<object>();
const managerCache = new Map<string, Promise<AutoReportManager>>();

function getArgValue(argv: string[] | undefined, flag: string): string | undefined {
  if (!argv) {
    return undefined;
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === flag) {
      return argv[i + 1];
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }

  return undefined;
}

function resolveConfigPath(processRef: ProcessLike, explicitPath?: string): string | undefined {
  return explicitPath ??
    getArgValue(processRef.argv, '--config') ??
    processRef.env.AUTOHAND_CONFIG;
}

function detectClientName(processRef: ProcessLike): string {
  const envClientName = processRef.env.AUTOHAND_CLIENT_NAME;
  if (envClientName) {
    return envClientName;
  }

  const mode = getArgValue(processRef.argv, '--mode');
  if (mode === 'acp' || mode === 'rpc') {
    return mode;
  }

  return 'cli';
}

function getLogPrefix(processRef: ProcessLike): string {
  return detectClientName(processRef) === 'acp' ? '[ACP]' : '[DEBUG]';
}

function captureLastError(reason: unknown): void {
  (globalThis as { __autohandLastError?: unknown }).__autohandLastError = reason;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildFallbackConfig(configPath: string | undefined, processRef: ProcessLike): LoadedConfig {
  return {
    provider: 'openrouter',
    api: {
      baseUrl: processRef.env.AUTOHAND_API_URL || DEFAULT_API_BASE_URL,
      companySecret: processRef.env.AUTOHAND_SECRET || '',
    },
    autoReport: {
      enabled: true,
    },
    telemetry: {
      enabled: false,
    },
    configPath: configPath ?? 'process-error-fallback',
    isNewConfig: false,
  };
}

async function getAutoReportManager(processRef: ProcessLike, explicitConfigPath?: string): Promise<AutoReportManager> {
  const configPath = resolveConfigPath(processRef, explicitConfigPath);
  const cacheKey = configPath ?? '__default__';
  const cached = managerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const managerPromise = (async () => {
    let config: LoadedConfig;
    try {
      config = await loadConfig(configPath);
    } catch {
      config = buildFallbackConfig(configPath, processRef);
    }

    return new AutoReportManager(config, packageJson.version);
  })();

  managerCache.set(cacheKey, managerPromise);
  return managerPromise;
}

function isIgnorableStdinReadError(err: unknown, _processRef: ProcessLike): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const maybeError = err as {
    code?: string;
    syscall?: string;
    fd?: number;
  };
  // EIO on read syscall means the pty/terminal was torn down (e.g. Ctrl+C during
  // an Ink modal). This is safe to ignore regardless of which fd — Ink may use
  // duplicated file descriptors (fd 6, etc.) rather than stdin's fd 0.
  return maybeError.code === 'EIO' && maybeError.syscall === 'read';
}

/**
 * Filesystem errors that are expected operational conditions:
 * - EACCES on mkdir: user running CLI in a directory they can't write to
 * - EEXIST on mkdir: race condition when multiple processes create the same dir
 */
function isIgnorableFilesystemError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeError = err as { code?: string; syscall?: string };
  if (maybeError.syscall !== 'mkdir') return false;
  return maybeError.code === 'EACCES' || maybeError.code === 'EEXIST';
}

/**
 * Terminal/IO errors that are expected during shutdown or in non-standard terminals:
 * - setRawMode errno: TTY is dead (bad file descriptor during component unmount)
 * - Generator is executing: concurrent readline/shell operations (harmless race)
 * - node:sqlite resolution: runtime doesn't support node:sqlite (e.g. Bun)
 */
function isIgnorableTerminalOrRuntimeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as Error).message ?? '';
  if (/setRawMode.*errno/i.test(message)) return true;
  if (message === 'Generator is executing') return true;
  if (message.includes('node:sqlite')) return true;
  return false;
}

function isIgnorableUnhandledRejection(reason: unknown, processRef: ProcessLike): boolean {
  if (reason && typeof reason === 'object' && (reason as { code?: string }).code === 'ERR_USE_AFTER_CLOSE') {
    return true;
  }

  if (isIgnorableStdinReadError(reason, processRef)) return true;
  if (isIgnorableFilesystemError(reason)) return true;
  if (isIgnorableTerminalOrRuntimeError(reason)) return true;

  return false;
}

function toReportableError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const fallbackName = 'NonErrorProcessFault';

  if (reason && typeof reason === 'object') {
    const maybeErrorLike = reason as {
      name?: unknown;
      message?: unknown;
    };
    const message = typeof maybeErrorLike.message === 'string'
      ? maybeErrorLike.message
      : safeSerialize(reason);
    const error = new Error(message);
    error.name = typeof maybeErrorLike.name === 'string' ? maybeErrorLike.name : fallbackName;
    return error;
  }

  const error = new Error(typeof reason === 'string' ? reason : String(reason));
  error.name = fallbackName;
  return error;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeReasonType(reason: unknown): string {
  if (reason === null) {
    return 'null';
  }
  if (Array.isArray(reason)) {
    return 'array';
  }
  return typeof reason;
}

export async function reportProcessError(reason: unknown, options: ProcessErrorContext): Promise<void> {
  const processRef = options.processRef ?? process;

  if (options.handler === 'unhandledRejection' && isIgnorableUnhandledRejection(reason, processRef)) {
    return;
  }
  if (options.handler === 'uncaughtException' &&
    (isIgnorableStdinReadError(reason, processRef) || isIgnorableTerminalOrRuntimeError(reason))) {
    return;
  }

  captureLastError(reason);

  const error = toReportableError(reason);
  const manager = await getAutoReportManager(processRef, options.configPath);
  const reportPromise = manager.reportError(error, {
    context: {
      source: 'process',
      handler: options.handler,
      clientName: detectClientName(processRef),
      fatal: options.handler === 'uncaughtException',
      rawType: describeReasonType(reason),
      ...(options.extraContext ?? {}),
    },
  });

  await Promise.race([
    reportPromise,
    sleep(options.reportTimeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS),
  ]);
}

export function installProcessErrorHandlers(options: InstallProcessErrorHandlersOptions = {}): void {
  const processRef = options.processRef ?? process;

  if (installedProcesses.has(processRef as object)) {
    return;
  }
  installedProcesses.add(processRef as object);

  const logError = options.logError ?? console.error.bind(console);
  const exit = options.exit ?? ((code: number) => {
    processRef.exit(code);
  });

  processRef.on('uncaughtException', (error) => {
    if (isIgnorableStdinReadError(error, processRef)) {
      return;
    }
    if (isIgnorableTerminalOrRuntimeError(error)) {
      return;
    }

    captureLastError(error);
    logError(`${getLogPrefix(processRef)} Uncaught Exception:`, error);

    void (async () => {
      await reportProcessError(error, {
        handler: 'uncaughtException',
        processRef,
        configPath: options.configPath,
        reportTimeoutMs: options.reportTimeoutMs,
      });
      exit(1);
    })();
  });

  processRef.on('unhandledRejection', (reason, promise) => {
    if (isIgnorableUnhandledRejection(reason, processRef)) {
      return;
    }

    captureLastError(reason);
    logError(`${getLogPrefix(processRef)} Unhandled Rejection at:`, promise, 'reason:', reason);

    void reportProcessError(reason, {
      handler: 'unhandledRejection',
      processRef,
      configPath: options.configPath,
      reportTimeoutMs: options.reportTimeoutMs,
    });
  });
}

export function resetProcessErrorReportingForTests(): void {
  managerCache.clear();
  installedProcesses = new WeakSet<object>();
}
