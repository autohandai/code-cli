/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AgentAction,
  AssistantReactPayload,
  LLMMessage,
  LLMToolCall,
  ToolCallRequest,
} from '../../types.js';
import {
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  type ToolLoopResult,
} from './ToolLoopSignature.js';

export type ToolLoopCallDecision =
  | { type: 'allow'; signature: string; repeatCount: number }
  | { type: 'force_final'; signature: string; repeatCount: number }
  | { type: 'reject'; signature: string; violationCount: number; exhausted: boolean };

export interface ToolLoopResultDecision {
  signature: string;
  repeatCount: number;
  forcedFinalResponse: boolean;
}

export type ToolReflectionDecision =
  | { type: 'allow' }
  | { type: 'require_reflection' }
  | { type: 'force_final' }
  | { type: 'integrity_failure' };

export interface ToolLoopGuardOptions {
  identicalCallHardLimit?: number;
  identicalCallAndResultLimit?: number;
  forcedToolCallLimit?: number;
}

export interface NativeToolResultIntegrity {
  ok: boolean;
  missingAssistantCallIds: string[];
  missingResults: Array<{ id: string; tool: AgentAction['type'] }>;
}

export function resolveAssistantToolCalls(
  nativeToolCalls: LLMToolCall[] | undefined,
  parsedToolCalls: ToolCallRequest[] | undefined,
  supportsNativeToolCalling: boolean,
): LLMToolCall[] {
  if (nativeToolCalls?.length) {
    return nativeToolCalls;
  }
  if (!supportsNativeToolCalling || !parsedToolCalls?.length) {
    return [];
  }

  return parsedToolCalls.flatMap((call) => call.id ? [{
    id: call.id,
    type: 'function' as const,
    function: {
      name: call.tool,
      arguments: JSON.stringify(call.args ?? {}),
    },
  }] : []);
}

export class ToolLoopGuard {
  private readonly identicalCallHardLimit: number;
  private readonly identicalCallAndResultLimit: number;
  private readonly forcedToolCallLimit: number;
  private lastCallSignature = '';
  private identicalCallCount = 0;
  private lastResultSignature = '';
  private identicalResultCount = 0;
  private forceFinal = false;
  private forcedToolCallCount = 0;

  constructor(options: ToolLoopGuardOptions = {}) {
    this.identicalCallHardLimit = options.identicalCallHardLimit ?? 6;
    this.identicalCallAndResultLimit = options.identicalCallAndResultLimit ?? 3;
    this.forcedToolCallLimit = options.forcedToolCallLimit ?? 2;
  }

  isForcingFinalResponse(): boolean {
    return this.forceFinal;
  }

  forceFinalResponse(): void {
    this.forceFinal = true;
  }

  observeCalls(calls: ToolCallRequest[]): ToolLoopCallDecision {
    const signature = buildToolLoopCallSignature(calls);
    if (signature === this.lastCallSignature) {
      this.identicalCallCount += 1;
    } else {
      this.lastCallSignature = signature;
      this.identicalCallCount = 1;
      this.lastResultSignature = '';
      this.identicalResultCount = 0;
      this.forcedToolCallCount = 0;
    }

    if (this.forceFinal) {
      this.forcedToolCallCount += 1;
      return {
        type: 'reject',
        signature,
        violationCount: this.forcedToolCallCount,
        exhausted: this.forcedToolCallCount >= this.forcedToolCallLimit,
      };
    }

    if (this.identicalCallCount >= this.identicalCallHardLimit) {
      this.forceFinal = true;
      return {
        type: 'force_final',
        signature,
        repeatCount: this.identicalCallCount,
      };
    }

    return {
      type: 'allow',
      signature,
      repeatCount: this.identicalCallCount,
    };
  }

  observeResults(results: ToolLoopResult[]): ToolLoopResultDecision {
    const signature = buildToolLoopResultSignature(results);
    if (signature === this.lastResultSignature) {
      this.identicalResultCount += 1;
    } else {
      this.lastResultSignature = signature;
      this.identicalResultCount = 1;
    }

    const forcedFinalResponse =
      this.identicalCallCount >= this.identicalCallAndResultLimit
      && this.identicalResultCount >= this.identicalCallAndResultLimit;
    if (forcedFinalResponse) {
      this.forceFinal = true;
    }

    return {
      signature,
      repeatCount: this.identicalResultCount,
      forcedFinalResponse,
    };
  }
}

const MISSING_TOOL_OBSERVATION_PATTERNS = [
  /\b(?:tool|command|function)\s+(?:output|result)s?\b.{0,48}\b(?:not|never|wasn't|weren't|isn't|aren't)\b.{0,24}\b(?:visible|available|received|provided|shown)\b/i,
  /\b(?:cannot|can't|could not|couldn't|did not|didn't)\b.{0,36}\b(?:see|access|receive|find)\b.{0,24}\b(?:tool|command|function)\s+(?:output|result)s?\b/i,
  /\b(?:previous|prior|last)\s+(?:tool|command|function)\s+(?:output|result)s?\b.{0,36}\b(?:missing|unavailable|absent|not visible|wasn't visible|weren't visible)\b/i,
] as const;

export function reportsMissingToolObservation(...values: Array<string | undefined>): boolean {
  const text = values.filter((value): value is string => Boolean(value?.trim())).join(' ');
  return text.length > 0 && MISSING_TOOL_OBSERVATION_PATTERNS.some((pattern) => pattern.test(text));
}

export class ToolReflectionGuard {
  private awaitingReflection = false;
  private violationCount = 0;

  expectReflection(): void {
    this.awaitingReflection = true;
  }

  evaluate(payload: AssistantReactPayload): ToolReflectionDecision {
    if (!this.awaitingReflection) {
      return { type: 'allow' };
    }

    const toolCalls = payload.toolCalls ?? [];
    if (toolCalls.length === 0) {
      this.awaitingReflection = false;
      this.violationCount = 0;
      return { type: 'allow' };
    }

    if (reportsMissingToolObservation(payload.reflection, payload.thought)) {
      this.awaitingReflection = false;
      this.violationCount = 0;
      return { type: 'integrity_failure' };
    }

    const hasMeaningfulReflection = Boolean(payload.reflection?.trim());
    const hasSubstantiveThought = (payload.thought?.trim().length ?? 0) > 50;
    if (hasMeaningfulReflection || hasSubstantiveThought) {
      this.awaitingReflection = false;
      this.violationCount = 0;
      return { type: 'allow' };
    }

    this.violationCount += 1;
    if (this.violationCount < 2) {
      return { type: 'require_reflection' };
    }

    this.awaitingReflection = false;
    this.violationCount = 0;
    return { type: 'force_final' };
  }
}

export function inspectExpectedNativeToolResults(
  messages: LLMMessage[],
  expectedToolCallIds: string[],
): NativeToolResultIntegrity {
  const assistantCalls = new Map<string, AgentAction['type']>();
  const toolResultIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        assistantCalls.set(call.id, call.function.name as AgentAction['type']);
      }
    } else if (message.role === 'tool' && message.tool_call_id) {
      toolResultIds.add(message.tool_call_id);
    }
  }

  const missingAssistantCallIds: string[] = [];
  const missingResults: Array<{ id: string; tool: AgentAction['type'] }> = [];
  for (const id of [...new Set(expectedToolCallIds)]) {
    const tool = assistantCalls.get(id);
    if (!tool) {
      missingAssistantCallIds.push(id);
    } else if (!toolResultIds.has(id)) {
      missingResults.push({ id, tool });
    }
  }

  return {
    ok: missingAssistantCallIds.length === 0 && missingResults.length === 0,
    missingAssistantCallIds,
    missingResults,
  };
}
