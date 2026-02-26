/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

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
  onMessage(stream: Readable, callback: (msg: RpcMessage) => void): void {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as RpcMessage;
        if (parsed.method) {
          callback(parsed);
        }
      } catch {
        // Ignore non-JSON lines (stderr leakage, debug output, etc.)
      }
    });
  }

  /**
   * Send a JSON-RPC 2.0 message to a writable stream as a single
   * newline-terminated line.
   */
  send(stream: Writable, msg: { method: string; params: Record<string, unknown> }): void {
    const line = MessageRouter.encode(msg) + '\n';
    stream.write(line);
  }
}
