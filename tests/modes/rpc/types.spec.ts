/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isNotification,
  createRequest,
  createNotification,
  createResponse,
  createErrorResponse,
  RPC_METHODS,
  RPC_NOTIFICATIONS,
  JSON_RPC_ERROR_CODES,
} from '../../../src/modes/rpc/types.js';

describe('JSON-RPC 2.0 Types', () => {
  describe('isJsonRpcRequest', () => {
    it('returns true for valid request with id', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'autohand.prompt',
        params: { message: 'hello' },
        id: 'req_1',
      };
      expect(isJsonRpcRequest(request)).toBe(true);
    });

    it('returns true for valid notification (no id)', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'autohand.messageUpdate',
        params: { delta: 'hello' },
      };
      expect(isJsonRpcRequest(notification)).toBe(true);
    });

    it('returns false for missing jsonrpc version', () => {
      const invalid = {
        method: 'test',
        id: 1,
      };
      expect(isJsonRpcRequest(invalid)).toBe(false);
    });

    it('returns false for wrong jsonrpc version', () => {
      const invalid = {
        jsonrpc: '1.0',
        method: 'test',
        id: 1,
      };
      expect(isJsonRpcRequest(invalid)).toBe(false);
    });

    it('returns false for missing method', () => {
      const invalid = {
        jsonrpc: '2.0',
        id: 1,
      };
      expect(isJsonRpcRequest(invalid)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isJsonRpcRequest(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isJsonRpcRequest('string')).toBe(false);
      expect(isJsonRpcRequest(42)).toBe(false);
    });
  });

  describe('isJsonRpcResponse', () => {
    it('returns true for valid success response', () => {
      const response = {
        jsonrpc: '2.0',
        result: { success: true },
        id: 'req_1',
      };
      expect(isJsonRpcResponse(response)).toBe(true);
    });

    it('returns true for valid error response', () => {
      const response = {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: 'req_1',
      };
      expect(isJsonRpcResponse(response)).toBe(true);
    });

    it('returns false for request (has method instead of result/error)', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1,
      };
      expect(isJsonRpcResponse(request)).toBe(false);
    });

    it('returns false for missing jsonrpc version', () => {
      const invalid = {
        result: {},
        id: 1,
      };
      expect(isJsonRpcResponse(invalid)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isJsonRpcResponse(null)).toBe(false);
    });
  });

  describe('isNotification', () => {
    it('returns true for request without id', () => {
      const notification = {
        jsonrpc: '2.0' as const,
        method: 'autohand.messageUpdate',
        params: { delta: 'hello' },
      };
      expect(isNotification(notification)).toBe(true);
    });

    it('returns false for request with id', () => {
      const request = {
        jsonrpc: '2.0' as const,
        method: 'autohand.prompt',
        params: { message: 'hello' },
        id: 'req_1',
      };
      expect(isNotification(request)).toBe(false);
    });

    it('returns false for request with null id', () => {
      const request = {
        jsonrpc: '2.0' as const,
        method: 'autohand.prompt',
        id: null,
      };
      expect(isNotification(request)).toBe(false);
    });
  });

  describe('createRequest', () => {
    it('creates valid request with params and id', () => {
      const request = createRequest('autohand.prompt', { message: 'hello' }, 'req_1');

      expect(request).toEqual({
        jsonrpc: '2.0',
        method: 'autohand.prompt',
        params: { message: 'hello' },
        id: 'req_1',
      });
    });

    it('creates request without params', () => {
      const request = createRequest('autohand.abort', undefined, 'req_2');

      expect(request).toEqual({
        jsonrpc: '2.0',
        method: 'autohand.abort',
        id: 'req_2',
      });
      expect(request.params).toBeUndefined();
    });

    it('creates request without id (notification)', () => {
      const request = createRequest('autohand.messageUpdate', { delta: 'hi' });

      expect(request).toEqual({
        jsonrpc: '2.0',
        method: 'autohand.messageUpdate',
        params: { delta: 'hi' },
      });
      expect(request.id).toBeUndefined();
    });
  });

  describe('createNotification', () => {
    it('creates notification with params', () => {
      const notification = createNotification('autohand.messageUpdate', { delta: 'hello' });

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'autohand.messageUpdate',
        params: { delta: 'hello' },
      });
      expect(notification.id).toBeUndefined();
    });

    it('creates notification without params', () => {
      const notification = createNotification('autohand.agentEnd');

      expect(notification).toEqual({
        jsonrpc: '2.0',
        method: 'autohand.agentEnd',
      });
    });
  });

  describe('createResponse', () => {
    it('creates success response', () => {
      const response = createResponse('req_1', { success: true });

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: { success: true },
        id: 'req_1',
      });
      expect(response.error).toBeUndefined();
    });

    it('creates response with null result', () => {
      const response = createResponse('req_2', null);

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: null,
        id: 'req_2',
      });
    });
  });

  describe('createErrorResponse', () => {
    it('creates error response with standard error code', () => {
      const response = createErrorResponse(
        'req_1',
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'Missing parameter: message'
      );

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Missing parameter: message',
        },
        id: 'req_1',
      });
      expect(response.result).toBeUndefined();
    });

    it('creates error response with data', () => {
      const response = createErrorResponse(
        'req_2',
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        'Internal error',
        { stack: 'Error at...' }
      );

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: { stack: 'Error at...' },
        },
        id: 'req_2',
      });
    });
  });

  describe('RPC_METHODS', () => {
    it('defines all required methods', () => {
      expect(RPC_METHODS.PROMPT).toBe('autohand.prompt');
      expect(RPC_METHODS.ABORT).toBe('autohand.abort');
      expect(RPC_METHODS.RESET).toBe('autohand.reset');
      expect(RPC_METHODS.GET_STATE).toBe('autohand.getState');
      expect(RPC_METHODS.GET_MESSAGES).toBe('autohand.getMessages');
      expect(RPC_METHODS.PERMISSION_RESPONSE).toBe('autohand.permissionResponse');
    });
  });

  describe('RPC_NOTIFICATIONS', () => {
    it('defines all required notifications', () => {
      expect(RPC_NOTIFICATIONS.AGENT_START).toBe('autohand.agentStart');
      expect(RPC_NOTIFICATIONS.AGENT_END).toBe('autohand.agentEnd');
      expect(RPC_NOTIFICATIONS.TURN_START).toBe('autohand.turnStart');
      expect(RPC_NOTIFICATIONS.TURN_END).toBe('autohand.turnEnd');
      expect(RPC_NOTIFICATIONS.MESSAGE_START).toBe('autohand.messageStart');
      expect(RPC_NOTIFICATIONS.MESSAGE_UPDATE).toBe('autohand.messageUpdate');
      expect(RPC_NOTIFICATIONS.MESSAGE_END).toBe('autohand.messageEnd');
      expect(RPC_NOTIFICATIONS.TOOL_START).toBe('autohand.toolStart');
      expect(RPC_NOTIFICATIONS.TOOL_UPDATE).toBe('autohand.toolUpdate');
      expect(RPC_NOTIFICATIONS.TOOL_END).toBe('autohand.toolEnd');
      expect(RPC_NOTIFICATIONS.PERMISSION_REQUEST).toBe('autohand.permissionRequest');
      expect(RPC_NOTIFICATIONS.ERROR).toBe('autohand.error');
    });
  });

  describe('JSON_RPC_ERROR_CODES', () => {
    it('defines standard JSON-RPC 2.0 error codes', () => {
      expect(JSON_RPC_ERROR_CODES.PARSE_ERROR).toBe(-32700);
      expect(JSON_RPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
      expect(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
      expect(JSON_RPC_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
      expect(JSON_RPC_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
    });

    it('defines custom server error codes', () => {
      expect(JSON_RPC_ERROR_CODES.EXECUTION_ERROR).toBe(-32000);
      expect(JSON_RPC_ERROR_CODES.PERMISSION_DENIED).toBe(-32001);
      expect(JSON_RPC_ERROR_CODES.TIMEOUT).toBe(-32002);
      expect(JSON_RPC_ERROR_CODES.AGENT_BUSY).toBe(-32003);
      expect(JSON_RPC_ERROR_CODES.ABORTED).toBe(-32004);
    });
  });
});
