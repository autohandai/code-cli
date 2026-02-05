/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  parseRequest,
  serialize,
  LineReader,
  generateId,
  createTimestamp,
} from '../../../src/modes/rpc/protocol.js';
import { JSON_RPC_ERROR_CODES } from '../../../src/modes/rpc/types.js';
import { Readable } from 'stream';

describe('JSON-RPC 2.0 Protocol', () => {
  describe('parseRequest', () => {
    it('parses valid single request', () => {
      const json = JSON.stringify({
        jsonrpc: '2.0',
        method: 'autohand.prompt',
        params: { message: 'hello' },
        id: 'req_1',
      });

      const result = parseRequest(json);

      expect(result.type).toBe('single');
      if (result.type === 'single') {
        expect(result.request.method).toBe('autohand.prompt');
        expect(result.request.params).toEqual({ message: 'hello' });
        expect(result.request.id).toBe('req_1');
      }
    });

    it('parses valid batch request', () => {
      const json = JSON.stringify([
        { jsonrpc: '2.0', method: 'autohand.getState', id: 'req_1' },
        { jsonrpc: '2.0', method: 'autohand.getMessages', params: { limit: 10 }, id: 'req_2' },
      ]);

      const result = parseRequest(json);

      expect(result.type).toBe('batch');
      if (result.type === 'batch') {
        expect(result.requests).toHaveLength(2);
        expect(result.requests[0].method).toBe('autohand.getState');
        expect(result.requests[1].method).toBe('autohand.getMessages');
      }
    });

    it('returns parse error for invalid JSON', () => {
      const result = parseRequest('not valid json {');

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
        expect(result.message).toMatch(/^Parse error/);
      }
    });

    it('returns invalid request error for missing jsonrpc version', () => {
      const json = JSON.stringify({
        method: 'test',
        id: 1,
      });

      const result = parseRequest(json);

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
        expect(result.message).toMatch(/^Invalid request/);
      }
    });

    it('returns invalid request error for wrong jsonrpc version', () => {
      const json = JSON.stringify({
        jsonrpc: '1.0',
        method: 'test',
        id: 1,
      });

      const result = parseRequest(json);

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it('returns invalid request error for empty batch', () => {
      const json = JSON.stringify([]);

      const result = parseRequest(json);

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
        expect(result.message).toMatch(/^Invalid request/);
      }
    });

    it('filters invalid requests from batch', () => {
      const json = JSON.stringify([
        { jsonrpc: '2.0', method: 'autohand.getState', id: 'req_1' },
        { invalid: true }, // Should be filtered out
        { jsonrpc: '2.0', method: 'autohand.abort', id: 'req_2' },
      ]);

      const result = parseRequest(json);

      expect(result.type).toBe('batch');
      if (result.type === 'batch') {
        expect(result.requests).toHaveLength(2);
        expect(result.requests[0].method).toBe('autohand.getState');
        expect(result.requests[1].method).toBe('autohand.abort');
      }
    });

    it('handles notification (request without id)', () => {
      const json = JSON.stringify({
        jsonrpc: '2.0',
        method: 'autohand.messageUpdate',
        params: { delta: 'hello' },
      });

      const result = parseRequest(json);

      expect(result.type).toBe('single');
      if (result.type === 'single') {
        expect(result.request.method).toBe('autohand.messageUpdate');
        expect(result.request.id).toBeUndefined();
      }
    });
  });

  describe('serialize', () => {
    it('serializes request to JSON', () => {
      const request = {
        jsonrpc: '2.0' as const,
        method: 'autohand.prompt',
        params: { message: 'hello' },
        id: 'req_1',
      };

      const json = serialize(request);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(request);
    });

    it('serializes response to JSON', () => {
      const response = {
        jsonrpc: '2.0' as const,
        result: { success: true },
        id: 'req_1',
      };

      const json = serialize(response);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(response);
    });

    it('serializes array (batch) to JSON', () => {
      const batch = [
        { jsonrpc: '2.0' as const, result: { data: 1 }, id: 'req_1' },
        { jsonrpc: '2.0' as const, result: { data: 2 }, id: 'req_2' },
      ];

      const json = serialize(batch);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(batch);
    });
  });

  describe('generateId', () => {
    it('generates unique IDs with prefix', () => {
      const id1 = generateId('req');
      const id2 = generateId('req');

      expect(id1).toMatch(/^req_\d+_\d+$/);
      expect(id2).toMatch(/^req_\d+_\d+$/);
      expect(id1).not.toBe(id2);
    });

    it('uses default prefix when not specified', () => {
      const id = generateId();

      expect(id).toMatch(/^id_\d+_\d+$/);
    });
  });

  describe('createTimestamp', () => {
    it('returns ISO 8601 formatted timestamp', () => {
      const timestamp = createTimestamp();

      // Should be a valid ISO date string
      expect(() => new Date(timestamp)).not.toThrow();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it('returns current time', () => {
      const before = Date.now();
      const timestamp = createTimestamp();
      const after = Date.now();

      const timestampMs = new Date(timestamp).getTime();
      expect(timestampMs).toBeGreaterThanOrEqual(before);
      expect(timestampMs).toBeLessThanOrEqual(after);
    });
  });

  describe('LineReader', () => {
    it('reads complete lines from stream', async () => {
      const stream = Readable.from(['hello\nworld\n']);
      const reader = new LineReader(stream);

      const line1 = await reader.readLine();
      const line2 = await reader.readLine();

      expect(line1).toBe('hello');
      expect(line2).toBe('world');
    });

    it('handles partial lines buffered across chunks', async () => {
      const stream = Readable.from(['hel', 'lo\nwor', 'ld\n']);
      const reader = new LineReader(stream);

      const line1 = await reader.readLine();
      const line2 = await reader.readLine();

      expect(line1).toBe('hello');
      expect(line2).toBe('world');
    });

    it('throws when stream is closed', async () => {
      const stream = Readable.from(['hello\n']);
      const reader = new LineReader(stream);

      await reader.readLine(); // Consume the one line

      await expect(reader.readLine()).rejects.toThrow('Stream closed');
    });

    it('handles Windows-style line endings (CRLF)', async () => {
      const stream = Readable.from(['hello\r\nworld\r\n']);
      const reader = new LineReader(stream);

      const line1 = await reader.readLine();
      const line2 = await reader.readLine();

      // LineReader returns lines with CR if present, caller should trim if needed
      expect(line1).toBe('hello\r');
      expect(line2).toBe('world\r');
    });
  });
});
