/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readDeepResearchRun } from '../../deepResearch/session.js';

export interface PublishResearchPostTurnAction {
  kind: 'publish-research';
  runId: string;
  reportPath: string;
}

export type PendingPostTurnAction = PublishResearchPostTurnAction;

export interface QueuedAgentInstruction {
  text: string;
  postTurnAction?: PendingPostTurnAction;
}

export type PendingAgentInstruction = string | QueuedAgentInstruction;

export interface PostTurnEnvironment {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  isCI: boolean;
  isNonInteractive: boolean;
}

export interface PostTurnActionHost {
  runtime: {
    workspaceRoot: string;
    options: {
      prompt?: string;
      yes?: boolean;
      unrestricted?: boolean;
    };
    isCommandMode?: boolean;
    isRpcMode?: boolean;
  };
  shouldExit: boolean;
  interactiveAutomodeEnabled: boolean;
  automodeManager?: {
    isActive(): boolean;
  };
  runtimeResourceShutdownController?: AbortController;
  requestResearchPublication(reportPath: string): Promise<string>;
}

export function unpackQueuedAgentInstruction(
  value: PendingAgentInstruction,
): QueuedAgentInstruction {
  return typeof value === 'string' ? { text: value } : value;
}

export async function executePendingPostTurnAction(
  host: PostTurnActionHost,
  action: PendingPostTurnAction,
  turnSucceeded: boolean,
  environment: PostTurnEnvironment = currentPostTurnEnvironment(),
): Promise<string | null> {
  if (
    !turnSucceeded
    || host.shouldExit
    || host.runtimeResourceShutdownController?.signal.aborted
    || host.runtime.isCommandMode
    || host.runtime.isRpcMode
    || Boolean(host.runtime.options.prompt)
    || host.interactiveAutomodeEnabled
    || host.automodeManager?.isActive()
    || !environment.stdinIsTTY
    || !environment.stdoutIsTTY
    || environment.isCI
    || environment.isNonInteractive
  ) {
    return null;
  }

  const run = await readDeepResearchRun(host.runtime.workspaceRoot);
  if (
    !run
    || run.id !== action.runId
    || run.status !== 'completed'
    || run.reportPath !== action.reportPath
  ) {
    return null;
  }

  return host.requestResearchPublication(action.reportPath);
}

function currentPostTurnEnvironment(): PostTurnEnvironment {
  const ci = process.env.CI?.toLowerCase();
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    isCI: ci === '1' || ci === 'true',
    isNonInteractive: process.env.AUTOHAND_NON_INTERACTIVE === '1',
  };
}
