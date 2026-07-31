/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BlueprintSetupError,
  type BlueprintSetupSessionManager,
} from './blueprintSetup.js';
import {
  createErrorResponse,
  createResponse,
  isNotification,
  JSON_RPC_ERROR_CODES,
  RPC_METHODS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './types.js';

export interface BlueprintSetupRpcOutcome {
  response: JsonRpcResponse;
  terminal: boolean;
}

export async function handleBlueprintSetupRpcRequest(
  request: JsonRpcRequest,
  sessions: BlueprintSetupSessionManager,
): Promise<BlueprintSetupRpcOutcome> {
  const allowed = request.method === RPC_METHODS.LOGIN_BEGIN
    || request.method === RPC_METHODS.LOGIN_POLL
    || request.method === RPC_METHODS.LOGIN_CANCEL;
  if (!allowed) {
    return {
      response: createErrorResponse(
        request.id ?? null,
        JSON_RPC_ERROR_CODES.PROFILE_VIOLATION,
        `Method ${request.method} is disabled in Blueprint setup-only mode.`,
        {
          kind: 'profile_violation',
          stage: 'request',
          retryable: false,
        },
      ),
      terminal: true,
    };
  }
  if (isNotification(request)) {
    return {
      response: createErrorResponse(
        null,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        'Blueprint setup-only methods require a request id.',
        {
          kind: 'request_id_required',
          stage: 'request',
          retryable: false,
        },
      ),
      terminal: true,
    };
  }

  try {
    const result = request.method === RPC_METHODS.LOGIN_BEGIN
      ? await sessions.begin(request.params)
      : request.method === RPC_METHODS.LOGIN_POLL
        ? await sessions.poll(request.params)
        : await sessions.cancel(request.params);
    return {
      response: createResponse(request.id ?? null, result),
      terminal: false,
    };
  } catch (error) {
    if (error instanceof BlueprintSetupError) {
      return {
        response: createErrorResponse(
          request.id ?? null,
          error.kind === 'invalid_params'
            ? JSON_RPC_ERROR_CODES.INVALID_PARAMS
            : JSON_RPC_ERROR_CODES.EXECUTION_ERROR,
          error.message,
          {
            kind: error.kind,
            stage: 'request',
            retryable: error.kind === 'initiation_failed' || error.kind === 'rate_limited',
          },
        ),
        terminal: false,
      };
    }
    return {
      response: createErrorResponse(
        request.id ?? null,
        JSON_RPC_ERROR_CODES.EXECUTION_ERROR,
        'Autohand device authorization failed.',
        {
          kind: 'setup_failed',
          stage: 'request',
          retryable: true,
        },
      ),
      terminal: false,
    };
  }
}
