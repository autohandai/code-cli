/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AssistantReactPayload,
  LLMResponse,
  ToolCallRequest,
} from '../../types.js';
import {
  classifyResponseCompletion,
  type ResponseCompletionHook,
} from './ResponseCompletionClassifier.js';

export type TurnRepairReason =
  | 'empty_no_tool_response'
  | 'invalid_deferred_action'
  | 'truncated_response';

export type TurnOutcome =
  | {
      type: 'continue_with_tools';
      toolCalls: ToolCallRequest[];
      thought?: string;
      saveAssistantMessage: true;
    }
  | {
      type: 'repair';
      reason: TurnRepairReason;
      instruction: string;
      saveAssistantMessage: false;
      rejectedResponse?: string;
      telemetry?: {
        reason: string;
        excerpt: string;
      };
    }
  | {
      type: 'finish';
      response: string;
      usedThoughtAsResponse: boolean;
      saveAssistantMessage: true;
    };

export interface TurnOutcomeInput {
  completion: LLMResponse;
  payload: AssistantReactPayload;
  cleanupModelResponse(content: string): string;
  responseCompletionHooks?: readonly ResponseCompletionHook[];
}

const EMPTY_NO_TOOL_INSTRUCTION =
  '[System] ERROR: Your previous assistant turn emitted no usable finalResponse and no tool calls. ' +
  'Either emit the required tool call now, or explain why no tool is needed and answer directly in finalResponse. ' +
  'Do not return another empty, JSON-only, or progress-only assistant message.';

const TRUNCATED_RESPONSE_INSTRUCTION =
  '[System] Your previous response was truncated due to output length limits. ' +
  'Please continue from where you left off. If you were making a tool call, retry it.';

function extractUsableResponse({
  completion,
  payload,
  cleanupModelResponse,
}: TurnOutcomeInput): { response: string; usedThoughtAsResponse: boolean } {
  const usedThoughtAsResponse = Boolean(payload.thought) &&
    !payload.finalResponse &&
    !payload.response &&
    !payload.toolCalls?.length;

  const cleanedContent = cleanupModelResponse(completion.content);
  const rawResponse = payload.finalResponse ??
    payload.response ??
    (!payload.toolCalls?.length && payload.thought ? payload.thought : undefined) ??
    (cleanedContent.startsWith('{') ? '' : cleanedContent);

  let response = cleanupModelResponse(rawResponse.trim());
  if (!response && usedThoughtAsResponse && payload.thought) {
    response = payload.thought.trim();
  }

  return { response, usedThoughtAsResponse };
}

export function evaluateAssistantTurn(input: TurnOutcomeInput): TurnOutcome {
  const { completion, payload, responseCompletionHooks } = input;
  const toolCalls = payload.toolCalls ?? [];
  const { response, usedThoughtAsResponse } = extractUsableResponse(input);

  if (completion.finishReason === 'length' && !payload.finalResponse) {
    return {
      type: 'repair',
      reason: 'truncated_response',
      instruction: TRUNCATED_RESPONSE_INSTRUCTION,
      saveAssistantMessage: false,
    };
  }

  if (toolCalls.length > 0) {
    return {
      type: 'continue_with_tools',
      toolCalls,
      thought: payload.thought,
      saveAssistantMessage: true,
    };
  }

  if (!response) {
    return {
      type: 'repair',
      reason: 'empty_no_tool_response',
      instruction: EMPTY_NO_TOOL_INSTRUCTION,
      saveAssistantMessage: false,
    };
  }

  if (responseCompletionHooks?.length) {
    const completionClassification = classifyResponseCompletion({
      response,
      toolCalls,
    }, responseCompletionHooks);

    if (completionClassification.kind === 'invalid_deferred_action') {
      return {
        type: 'repair',
        reason: 'invalid_deferred_action',
        instruction:
          `[System] ERROR: Your previous finalResponse announced an action but emitted no tool calls: "${completionClassification.excerpt}". ` +
          'Either emit the required tool call now, or explain why no tool is needed and answer directly in finalResponse. ' +
          'Do not write another progress update, SITREP, or next-step note as the finalResponse.',
        saveAssistantMessage: false,
        rejectedResponse: response,
        telemetry: {
          reason: completionClassification.reason,
          excerpt: completionClassification.excerpt,
        },
      };
    }
  }

  return {
    type: 'finish',
    response,
    usedThoughtAsResponse,
    saveAssistantMessage: true,
  };
}
