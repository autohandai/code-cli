/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------- detectStdinType ----------

describe('detectStdinType', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('returns "tty" when process.stdin.isTTY is true', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { detectStdinType } = await import('../src/utils/stdinDetector.js');
    expect(detectStdinType()).toBe('tty');
  });

  it('returns "pipe" when fstatSync shows FIFO', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockFstat = () =>
      ({ isFIFO: () => true, isFile: () => false }) as unknown as ReturnType<
        typeof import('node:fs').fstatSync
      >;

    const { detectStdinType } = await import('../src/utils/stdinDetector.js');
    expect(detectStdinType(mockFstat)).toBe('pipe');
  });

  it('returns "pipe" when fstatSync shows regular file (redirect)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockFstat = () =>
      ({ isFIFO: () => false, isFile: () => true }) as unknown as ReturnType<
        typeof import('node:fs').fstatSync
      >;

    const { detectStdinType } = await import('../src/utils/stdinDetector.js');
    expect(detectStdinType(mockFstat)).toBe('pipe');
  });

  it('returns "none" when stdin is neither TTY, FIFO, nor file', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockFstat = () =>
      ({ isFIFO: () => false, isFile: () => false }) as unknown as ReturnType<
        typeof import('node:fs').fstatSync
      >;

    const { detectStdinType } = await import('../src/utils/stdinDetector.js');
    expect(detectStdinType(mockFstat)).toBe('none');
  });

  it('returns "none" when fstatSync throws (e.g., EBADF)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockFstat = (): never => {
      throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
    };

    const { detectStdinType } = await import('../src/utils/stdinDetector.js');
    expect(detectStdinType(mockFstat)).toBe('none');
  });
});

// ---------- readPipedStdin ----------

describe('readPipedStdin', () => {
  let mockStdin: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockStdin = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with trimmed data when stdin emits data and end', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');

    const promise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);

    mockStdin.emit('data', '  hello world  \n');
    mockStdin.emit('end');

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('resolves with concatenated chunks on multiple data events', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');

    const promise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);

    mockStdin.emit('data', 'chunk1');
    mockStdin.emit('data', ' chunk2');
    mockStdin.emit('end');

    const result = await promise;
    expect(result).toBe('chunk1 chunk2');
  });

  it('resolves null when stdin emits an error', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');

    const promise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);

    mockStdin.emit('error', new Error('read error'));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('resolves null when timeout expires before end', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');

    // Use a very short real timeout - no data emitted, so it should timeout
    const result = await readPipedStdin(10, mockStdin as unknown as NodeJS.ReadableStream);
    expect(result).toBeNull();
  });

  it('resolves with data emitted before timeout', async () => {
    const { readPipedStdin } = await import('../src/utils/stdinDetector.js');

    const promise = readPipedStdin(5_000, mockStdin as unknown as NodeJS.ReadableStream);

    // Emit data and end before timeout expires
    mockStdin.emit('data', 'within default');
    mockStdin.emit('end');

    const result = await promise;
    expect(result).toBe('within default');
  });
});
