/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import {
  BlueprintAnswerError,
  parseBlueprintAnswerEnvelope,
  runBlueprintAnswer,
  type AnswerOnlyRuntimeProfile,
} from './blueprintAnswer.js';
import {
  createErrorResponse,
  createResponse,
  isNotification,
  JSON_RPC_ERROR_CODES,
  RPC_METHODS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type RuntimeFacts,
} from './types.js';

export interface BlueprintRpcContext {
  config: LoadedConfig;
  profile: AnswerOnlyRuntimeProfile;
  runtimeFacts: RuntimeFacts;
  providerFactory: () => LLMProvider;
}

export interface BlueprintRpcOutcome {
  response?: JsonRpcResponse;
  terminal: boolean;
}

interface BlueprintRpcErrorData {
  kind: string;
  stage: 'request';
  retryable: boolean;
}

function errorCode(error: BlueprintAnswerError): number {
  switch (error.kind) {
    case 'profile_violation':
      return JSON_RPC_ERROR_CODES.PROFILE_VIOLATION;
    case 'contract_invalid':
    case 'input_limit_exceeded':
      return JSON_RPC_ERROR_CODES.ANSWER_CONTRACT_INVALID;
    case 'authentication_required':
      return JSON_RPC_ERROR_CODES.AUTHENTICATION_REQUIRED;
    case 'inference_destination_blocked':
      return JSON_RPC_ERROR_CODES.INFERENCE_DESTINATION_BLOCKED;
    case 'output_limit_exceeded':
      return JSON_RPC_ERROR_CODES.OUTPUT_LIMIT_EXCEEDED;
    case 'output_invalid':
      return JSON_RPC_ERROR_CODES.OUTPUT_INVALID;
    case 'identity_unavailable':
    case 'local_model_setup_required':
    case 'local_engine_unavailable':
      return JSON_RPC_ERROR_CODES.INITIALIZATION_FAILED;
    case 'local_model_invalid':
    case 'inference_failed':
      return JSON_RPC_ERROR_CODES.EXECUTION_ERROR;
  }
}

function answerErrorResponse(
  request: JsonRpcRequest,
  error: BlueprintAnswerError,
): JsonRpcResponse {
  const data: BlueprintRpcErrorData = {
    kind: error.kind,
    stage: 'request',
    retryable: error.retryable,
  };
  return createErrorResponse(request.id ?? null, errorCode(error), error.message, data);
}

function paramsAreEmpty(params: JsonRpcRequest['params']): boolean {
  return params === undefined
    || (typeof params === 'object'
      && params !== null
      && !Array.isArray(params)
      && Object.keys(params).length === 0);
}

export async function handleBlueprintRpcRequest(
  request: JsonRpcRequest,
  context: BlueprintRpcContext,
): Promise<BlueprintRpcOutcome> {
  if (request.method !== RPC_METHODS.RUNTIME_INSPECT
      && request.method !== RPC_METHODS.ANSWER) {
    return {
      response: createErrorResponse(
        request.id ?? null,
        JSON_RPC_ERROR_CODES.PROFILE_VIOLATION,
        `Method ${request.method} is disabled in Blueprint answer-only mode.`,
        {
          kind: 'profile_violation',
          stage: 'request',
          retryable: false,
        } satisfies BlueprintRpcErrorData,
      ),
      terminal: true,
    };
  }

  if (isNotification(request)) {
    return {
      response: createErrorResponse(
        null,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        'Blueprint answer-only methods require a request id.',
        {
          kind: 'request_id_required',
          stage: 'request',
          retryable: false,
        } satisfies BlueprintRpcErrorData,
      ),
      terminal: true,
    };
  }

  if (request.method === RPC_METHODS.RUNTIME_INSPECT) {
    if (!paramsAreEmpty(request.params)) {
      return {
        response: createErrorResponse(
          request.id ?? null,
          JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          'autohand.runtimeInspect accepts no parameters.',
          {
            kind: 'invalid_params',
            stage: 'request',
            retryable: false,
          } satisfies BlueprintRpcErrorData,
        ),
        terminal: false,
      };
    }
    return {
      response: createResponse(request.id ?? null, context.runtimeFacts),
      terminal: false,
    };
  }

  try {
    const envelope = parseBlueprintAnswerEnvelope(request.params);
    const result = await runBlueprintAnswer({
      envelope,
      destination: context.runtimeFacts.inferenceDestination,
      providerId: context.runtimeFacts.providerId,
      ...(context.runtimeFacts.model ? { model: context.runtimeFacts.model } : {}),
      authentication: context.runtimeFacts.authentication,
      providerFactory: context.providerFactory,
    });
    return {
      response: createResponse(request.id ?? null, result),
      terminal: false,
    };
  } catch (error) {
    if (error instanceof BlueprintAnswerError) {
      return {
        response: answerErrorResponse(request, error),
        terminal: false,
      };
    }
    return {
      response: createErrorResponse(
        request.id ?? null,
        JSON_RPC_ERROR_CODES.EXECUTION_ERROR,
        'Blueprint answer execution failed.',
        {
          kind: 'inference_failed',
          stage: 'request',
          retryable: true,
        } satisfies BlueprintRpcErrorData,
      ),
      terminal: false,
    };
  }
}
