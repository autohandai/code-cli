/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { resolveCommandOutputFormat } from '../modes/commandOutput.js';
import type { CLIOptions, LoadedConfig } from '../types.js';
import type { ReviewCliInvocation } from './reviewCliCommand.js';
import type { ReviewExecutionSurface } from './reviewLifecycle.js';
import type { ReviewRequest } from './reviewRequest.js';

export interface ReviewCliExecution {
  authenticatedConfig: LoadedConfig;
  options: CLIOptions;
  review: {
    request: ReviewRequest;
    surface: ReviewExecutionSurface;
  };
}

export interface ReviewCliRuntimeDependencies {
  cwd(): string;
  loadConfig(configPath: string | undefined, cwd: string): Promise<LoadedConfig>;
  resolveWorkspaceRoot(config: LoadedConfig, workspacePath?: string): string;
  validateWorkspacePath(workspaceRoot: string): Promise<{ valid: boolean; error?: string }>;
  checkWorkspaceSafety(workspaceRoot: string): { safe: boolean; reason?: string };
  authenticate(config: LoadedConfig, options: { bare: boolean }): Promise<LoadedConfig>;
  buildInstruction(workspaceRoot: string, request: ReviewRequest): Promise<string>;
  run(execution: ReviewCliExecution): Promise<void>;
}

export async function executeReviewCliInvocation(
  invocation: ReviewCliInvocation,
  dependencies: ReviewCliRuntimeDependencies,
): Promise<void> {
  const output = resolveCommandOutputFormat(invocation.runtimeOptions);
  if ('error' in output) throw new Error(output.error);

  const cwd = dependencies.cwd();
  // Project overlays belong to the reviewed workspace, not the launch directory.
  const config = await dependencies.loadConfig(
    invocation.runtimeOptions.config,
    path.resolve(cwd, invocation.runtimeOptions.path ?? '.'),
  );
  const workspaceRoot = dependencies.resolveWorkspaceRoot(
    config,
    invocation.runtimeOptions.path,
  );
  const validation = await dependencies.validateWorkspacePath(workspaceRoot);
  if (!validation.valid) {
    throw new Error(validation.error ?? `Workspace path is unavailable: ${workspaceRoot}`);
  }
  const safety = dependencies.checkWorkspaceSafety(workspaceRoot);
  if (!safety.safe) {
    throw new Error(safety.reason ?? `Workspace path is unsafe: ${workspaceRoot}`);
  }

  const authenticatedConfig = await dependencies.authenticate(config, {
    bare: invocation.runtimeOptions.bare === true,
  });
  const instruction = await dependencies.buildInstruction(workspaceRoot, invocation.request);

  await dependencies.run({
    authenticatedConfig,
    options: {
      ...invocation.runtimeOptions,
      commandOutputFormat: output.format,
      prompt: instruction,
      restricted: true,
      unrestricted: false,
      yes: false,
      dryRun: false,
    },
    review: {
      request: invocation.request,
      surface: 'cli',
    },
  });
}
