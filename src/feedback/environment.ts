/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import { getShellExecutionProfile } from '../utils/shellExecution.js';

export interface ReportEnvironmentInput {
  provider?: string;
  model?: string;
  interactionMode?: string;
  /** Defaults to `process.env`; injectable so tests do not depend on the host terminal. */
  env?: NodeJS.ProcessEnv;
}

const MAX_VALUE_CHARS = 200;

/**
 * Describes where the CLI is running for a bug report. It is an allowlist:
 * only the named facts are read, so no variable value, path or address can
 * leak just because it happened to be set.
 */
export function collectReportEnvironment(input: ReportEnvironmentInput = {}): Record<string, string> {
  const env = input.env ?? process.env;
  const parentShellPath = env.SHELL ?? env.ComSpec;
  let executionShell: ReturnType<typeof getShellExecutionProfile> | undefined;
  try { executionShell = getShellExecutionProfile({ environment: env }); } catch { /* Keep error reporting available when shell resolution fails. */ }
  const shellName = executionShell ? path.basename(executionShell.executable.replaceAll('\\', '/')) : 'unresolved';
  const parentShell = parentShellPath ? path.basename(parentShellPath.replaceAll('\\', '/')) : undefined;
  const size = process.stdout.isTTY ? `${process.stdout.columns}x${process.stdout.rows}` : undefined;

  const facts: Record<string, string | undefined> = {
    os: `${process.platform} ${os.release()} (${process.arch})`,
    runtime: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`,
    shell: shellName,
    shellDialect: executionShell?.dialect,
    parentShell: parentShell !== shellName ? parentShell : undefined,
    terminal: [env.TERM_PROGRAM, env.TERM_PROGRAM_VERSION].filter(Boolean).join(' '),
    term: env.TERM,
    multiplexer: env.TMUX ? 'tmux' : env.STY ? 'screen' : undefined,
    size,
    locale: env.LC_ALL || env.LANG,
    ssh: env.SSH_CONNECTION || env.SSH_TTY ? 'yes' : undefined,
    ci: env.CI ? 'yes' : undefined,
    provider: input.provider,
    model: input.model,
    mode: input.interactionMode,
  };

  return Object.fromEntries(
    Object.entries(facts).flatMap(([key, value]) => (value ? [[key, value.slice(0, MAX_VALUE_CHARS)]] : [])),
  );
}
