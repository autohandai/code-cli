/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  parseRequest,
  serialize,
  LineReader,
  generateId,
  createTimestamp,
  writeErrorResponse,
  writeNotification,
  writeResponse,
} from '../../../src/modes/rpc/protocol.js';
import { JSON_RPC_ERROR_CODES } from '../../../src/modes/rpc/types.js';
import { PassThrough, Readable } from 'stream';

const originalDebugValue = process.env.AUTOHAND_DEBUG;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDebugValue === undefined) {
    delete process.env.AUTOHAND_DEBUG;
  } else {
    process.env.AUTOHAND_DEBUG = originalDebugValue;
  }
});

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

    it('keeps serialization errors metadata-only when debug logging is enabled', () => {
      const serializationError = Object.assign(new Error('SERIALIZATION_ERROR_SENTINEL'), {
        name: 'ERROR_NAME_SENTINEL\nINJECTED_LOG_LINE',
      });
      const unserializable = {
        toJSON(): never {
          throw serializationError;
        },
      };
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      delete process.env.AUTOHAND_DEBUG;
      const quietResult = serialize(unserializable as never);

      expect(JSON.parse(quietResult)).toMatchObject({
        jsonrpc: '2.0',
        error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR },
        id: null,
      });
      expect(stderr).not.toHaveBeenCalled();

      process.env.AUTOHAND_DEBUG = '1';
      const debugResult = serialize(unserializable as never);
      const diagnostics = stderr.mock.calls.map(([value]) => String(value)).join('');

      expect(debugResult).toBe(quietResult);
      expect(diagnostics).toContain('[RPC DEBUG] Serialization failed: errorType=Error');
      expect(diagnostics).toContain('messageLength=28');
      expect(diagnostics).not.toContain('SERIALIZATION_ERROR_SENTINEL');
      expect(diagnostics).not.toContain('ERROR_NAME_SENTINEL');
      expect(diagnostics).not.toContain('INJECTED_LOG_LINE');
    });

    it('preserves fallback serialization when a thrown value rejects string coercion', () => {
      const hostileValue = {
        [Symbol.toPrimitive](): never {
          throw new Error('COERCION_SENTINEL');
        },
      };
      const unserializable = {
        toJSON(): never {
          throw hostileValue;
        },
      };
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      process.env.AUTOHAND_DEBUG = '1';

      const result = serialize(unserializable as never);
      const diagnostics = stderr.mock.calls.map(([value]) => String(value)).join('');

      expect(JSON.parse(result)).toMatchObject({
        jsonrpc: '2.0',
        error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR },
        id: null,
      });
      expect(diagnostics).toContain('errorType=object, messageLength=0');
      expect(diagnostics).not.toContain('COERCION_SENTINEL');
    });
  });

  describe('output diagnostics', () => {
    it('preserves stdout framing while debug metadata remains opt-in', () => {
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const params = { content: 'STDOUT_PAYLOAD_SENTINEL' };

      delete process.env.AUTOHAND_DEBUG;
      writeNotification('autohand.messageUpdate', params);
      const quietOutput = stdout.mock.calls[0]?.[0];

      expect(quietOutput).toBe(`${JSON.stringify({
        jsonrpc: '2.0',
        method: 'autohand.messageUpdate',
        params,
      })}\n`);
      expect(stderr).not.toHaveBeenCalled();

      stdout.mockClear();
      process.env.AUTOHAND_DEBUG = 'true';
      writeNotification('autohand.messageUpdate', params);

      expect(stdout.mock.calls[0]?.[0]).toBe(quietOutput);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringMatching(/^\[RPC DEBUG\] writeNotification method=autohand\.messageUpdate size=\d+b\n$/)
      );
      expect(stderr.mock.calls.map(([value]) => String(value)).join(''))
        .not.toContain('STDOUT_PAYLOAD_SENTINEL');
    });

    it('redacts client-controlled response IDs from debug diagnostics', () => {
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const id = 'RPC_ID_SENTINEL\nINJECTED_LOG_LINE';
      process.env.AUTOHAND_DEBUG = '1';

      writeResponse(id, { success: true });
      writeErrorResponse(id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, 'public protocol error');

      const diagnostics = stderr.mock.calls.map(([value]) => String(value)).join('');
      expect(stdout).toHaveBeenCalledTimes(2);
      expect(diagnostics).toContain(`idType=string idLength=${id.length}`);
      expect(diagnostics).not.toContain('RPC_ID_SENTINEL');
      expect(diagnostics).not.toContain('INJECTED_LOG_LINE');
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

    it('rejects a pending read when the stream ends', async () => {
      const stream = new PassThrough();
      const reader = new LineReader(stream);
      const pendingRead = expect(reader.readLine()).rejects.toThrow('Stream closed');

      stream.end();

      await pendingRead;
    });

    it('disposes stream listeners and pending reads idempotently', async () => {
      const stream = new PassThrough();
      const baseline = {
        data: stream.listenerCount('data'),
        end: stream.listenerCount('end'),
        close: stream.listenerCount('close'),
      };
      const reader = new LineReader(stream);
      const pendingRead = expect(reader.readLine()).rejects.toThrow('Stream closed');

      expect(stream.listenerCount('data')).toBe(baseline.data + 1);
      expect(stream.listenerCount('end')).toBe(baseline.end + 1);
      expect(stream.listenerCount('close')).toBe(baseline.close + 1);

      reader.dispose();
      reader.dispose();

      await pendingRead;
      expect(stream.listenerCount('data')).toBe(baseline.data);
      expect(stream.listenerCount('end')).toBe(baseline.end);
      expect(stream.listenerCount('close')).toBe(baseline.close);
    });
  });
});
