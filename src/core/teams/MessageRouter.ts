/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Readable, Writable } from 'node:stream';

const MAX_CHANNEL_BYTES = 1024 * 1024;

interface RpcMessage {
  jsonrpc?: '2.0';
  method: string;
  params: Record<string, unknown>;
  id?: number;
}

/**
 * Handles encoding/decoding JSON-RPC 2.0 messages as newline-delimited JSON
 * over Node.js streams. Used by TeammateProcess and TeamManager for
 * inter-agent communication via stdio.
 */
export class MessageRouter {
  /**
   * Encode a message payload into a JSON-RPC 2.0 JSON string.
   * Always stamps `jsonrpc: "2.0"` onto the output.
   */
  static encode(msg: { method: string; params: Record<string, unknown> }): string {
    return JSON.stringify({ jsonrpc: '2.0', ...msg });
  }

  /**
   * Subscribe to incoming JSON-RPC messages from a readable stream.
   * Each newline-delimited line is parsed; non-JSON lines and messages
   * without a `method` field are silently ignored (stderr leakage,
   * debug output, etc.).
   */
  onMessage(
    stream: Readable,
    callback: (msg: RpcMessage) => void,
    onError?: (error: Error) => void,
  ): () => void {
    let pending: Buffer = Buffer.alloc(0);
    let stopped = false;
    let failed = false;
    const handleError = (error: Error): void => { onError?.(error); };
    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          && 'method' in parsed && typeof parsed.method === 'string' && parsed.method.length > 0
          && 'params' in parsed && typeof parsed.params === 'object' && parsed.params !== null
          && !Array.isArray(parsed.params)) {
          callback(parsed as RpcMessage);
        }
      } catch {
        // Ignore non-JSON lines (stderr leakage, debug output, etc.)
      }
    };
    const handleData = (data: Buffer | string): void => {
      if (stopped || failed) return;
      const bytes = typeof data === 'string' ? Buffer.from(data) : data;
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline < 0 ? bytes.length : newline;
        if (pending.length + end - offset > MAX_CHANNEL_BYTES) {
          failed = true;
          pending = Buffer.alloc(0);
          handleError(new Error('Teammate input frame exceeds the channel limit.'));
          return;
        }
        pending = Buffer.concat([pending, bytes.subarray(offset, end)]);
        if (newline < 0) return;
        handleLine(pending.toString('utf8'));
        pending = Buffer.alloc(0);
        offset = newline + 1;
      }
    };
    const handleEnd = (): void => {
      if (!stopped && !failed && pending.length) handleLine(pending.toString('utf8'));
      pending = Buffer.alloc(0);
    };
    stream.on('error', handleError);
    stream.on('data', handleData);
    stream.on('end', handleEnd);
    return () => {
      stopped = true;
      pending = Buffer.alloc(0);
      stream.off('data', handleData);
      stream.off('end', handleEnd);
      stream.off('error', handleError);
    };
  }

  /**
   * Send a JSON-RPC 2.0 message to a writable stream as a single
   * newline-terminated line.
   */
  send(stream: Writable, msg: { method: string; params: Record<string, unknown> }): void {
    const line = MessageRouter.encode(msg) + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > MAX_CHANNEL_BYTES || stream.writableLength + bytes > MAX_CHANNEL_BYTES) {
      throw new Error('Teammate output exceeds the bounded channel queue.');
    }
    if (stream.destroyed || stream.writableEnded) throw new Error('Teammate output is closed.');
    stream.write(line);
  }
}
