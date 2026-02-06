/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fstatSync as nodeFstatSync } from 'node:fs';

/**
 * Result type for stdin detection.
 * - `'tty'`  – interactive terminal (user is typing)
 * - `'pipe'` – piped input (FIFO or file redirect)
 * - `'none'` – no usable stdin (e.g., spawned process without pipe)
 */
export type StdinType = 'tty' | 'pipe' | 'none';

/**
 * Detect the type of stdin available to the process.
 *
 * Uses `process.stdin.isTTY` for the fast path, then falls back to
 * `fstatSync(0)` to distinguish pipe/file from no-stdin scenarios.
 *
 * Inspired by Cline's `piped.ts` pattern: `fstatSync(0).isFIFO()`.
 *
 * @param fstat - Optional fstatSync override for testing
 * @returns The detected stdin type
 */
export function detectStdinType(
  fstat: (fd: number) => ReturnType<typeof nodeFstatSync> = nodeFstatSync,
): StdinType {
  // Fast path: if the runtime already knows it's a TTY, trust it
  if (process.stdin.isTTY) {
    return 'tty';
  }

  try {
    const stat = fstat(0);
    if (stat.isFIFO() || stat.isFile()) {
      return 'pipe';
    }
    return 'none';
  } catch {
    // EBADF or other errors mean stdin fd is not available
    return 'none';
  }
}

/**
 * Read all piped input from stdin until EOF.
 *
 * Collects data chunks, resolves with the trimmed result.
 * Returns `null` on error or when the timeout expires.
 *
 * @param timeoutMs - Maximum time to wait for EOF (default: 300_000ms / 5 minutes)
 * @param stream    - Readable stream to read from (default: `process.stdin`)
 * @returns The trimmed stdin content, or `null` on error/timeout
 */
export function readPipedStdin(
  timeoutMs: number = 300_000,
  stream: NodeJS.ReadableStream = process.stdin,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const chunks: string[] = [];
    let settled = false;

    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };

    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };

    const onData = (chunk: string | Buffer) => {
      chunks.push(String(chunk));
    };

    const onEnd = () => {
      settle(chunks.join('').trim());
    };

    const onError = () => {
      settle(null);
    };

    // Set encoding so we receive strings instead of Buffers
    if ('setEncoding' in stream && typeof (stream as NodeJS.ReadStream).setEncoding === 'function') {
      (stream as NodeJS.ReadStream).setEncoding('utf-8');
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);

    const timer = setTimeout(() => {
      settle(null);
    }, timeoutMs);
  });
}
