/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentRunsSnapshot } from '../agents/AgentRunStore.js';
import type { DelegationExecutionOptions } from '../agents/AgentDelegator.js';
import { createQueuedAgentInstruction, type PendingAgentInstruction } from '../agent/PostTurnActionCoordinator.js';
import type { ToolDefinition } from '../toolManager.js';
import type { LoadedConfig, ToolActionOutcome } from '../../types.js';
import { isCliLanesEnabled } from './feature.js';
import { LaneManager, formatLaneReport, type Lane, type LaneRequest } from './LaneManager.js';
import { syncLaneTool } from './laneTool.js';

/** The parts of the agent runtime host that lanes read; all resolved lazily, at call time. */
export interface LaneRuntimeHost {
  delegator: {
    delegateTaskForTool(agentName: string, task: string, options?: DelegationExecutionOptions): Promise<ToolActionOutcome>;
  };
  agentRunStore: { subscribe(listener: (snapshot: AgentRunsSnapshot) => void): unknown };
  toolManager: { listAllDefinitions(): ToolDefinition[]; register(definition: ToolDefinition): void };
  inkRenderer?: {
    setLanes?(lanes: Lane[]): void;
    addNotification?(message: string): void;
  } | null;
  pendingInkInstructions: PendingAgentInstruction[];
  inkInstructionResolver: (() => void) | null;
  readlinePromptActive?: boolean;
  runtimeResourceShutdownController?: AbortController;
}

export interface LaneRuntimeEnvironment {
  config: LoadedConfig;
  isCommandMode?: boolean;
  isRpcMode?: boolean;
}

export interface LaneRuntime {
  accepts(request: LaneRequest): boolean;
  open(request: LaneRequest): ToolActionOutcome;
  /** Re-reads the experiment flag: updates the `delegate_task` schema and the lanes list. */
  sync(): void;
}

/** Lanes report into a conversation that is still open, so one-shot and protocol modes never get them. */
export function areLanesAvailable(environment: LaneRuntimeEnvironment): boolean {
  return isCliLanesEnabled(environment.config) && !environment.isCommandMode && !environment.isRpcMode;
}

/** Hands a settled lane to the lead as a queued, unechoed turn, the way peer messages arrive. */
function reportToLead(host: LaneRuntimeHost, lane: Lane, outcome: ToolActionOutcome): void {
  if (host.runtimeResourceShutdownController?.signal.aborted) return;
  host.inkRenderer?.addNotification?.(`Lane ${lane.name} ${lane.status}.`);
  host.pendingInkInstructions.push(createQueuedAgentInstruction({
    text: formatLaneReport(lane, outcome),
    echoInTranscript: false,
    executionPolicy: { environmentBootstrap: 'skip' },
  }));
  const resolver = host.inkInstructionResolver;
  if (resolver) {
    host.inkInstructionResolver = null;
    resolver();
  }
  if (host.readlinePromptActive) {
    void import('../../ui/inputPrompt.js').then(({ promptSuspend }) => { promptSuspend(); });
  }
}

export function createLaneRuntime(host: LaneRuntimeHost, environment: LaneRuntimeEnvironment): LaneRuntime {
  const isEnabled = (): boolean => areLanesAvailable(environment);
  const manager = new LaneManager({
    isEnabled,
    runTask: (agentName, task, options) => host.delegator.delegateTaskForTool(agentName, task, options),
    runs: host.agentRunStore,
    onChange: lanes => host.inkRenderer?.setLanes?.(lanes),
    onSettled: (lane, outcome) => reportToLead(host, lane, outcome),
    signal: host.runtimeResourceShutdownController?.signal,
  });
  const runtime: LaneRuntime = {
    accepts: request => manager.accepts(request),
    open: request => manager.open(request),
    sync: () => {
      syncLaneTool(host.toolManager, isEnabled());
      manager.refresh();
    },
  };
  runtime.sync();
  return runtime;
}
