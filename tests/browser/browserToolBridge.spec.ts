/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: invokeBrowserTool must NOT write raw JSON-RPC to process.stdout
 * in interactive mode. Doing so corrupts the terminal display (duplicated lines
 * in the composer). The bridge must use a configurable output stream.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Writable } from 'node:stream';

describe('browserToolBridge', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy?.mockRestore();
  });

  it('does NOT write to process.stdout by default', async () => {
    const { invokeBrowserTool } = await import('../../src/browser/browserToolBridge.js');

    // Fire and don't await (it waits for a response that won't come)
    const promise = invokeBrowserTool('browser_navigate', { url: 'https://example.com' });

    // Should NOT have written raw JSON to stdout
    const stdoutCalls = stdoutWriteSpy.mock.calls
      .map(c => String(c[0]))
      .filter(s => s.includes('jsonrpc'));
    expect(stdoutCalls).toHaveLength(0);

    // Clean up the pending promise
    promise.catch(() => {});
  });

  it('writes to a custom output stream when configured', async () => {
    const chunks: string[] = [];
    const customStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const { invokeBrowserTool, setBrowserBridgeOutput } = await import('../../src/browser/browserToolBridge.js');
    setBrowserBridgeOutput(customStream);

    const promise = invokeBrowserTool('browser_navigate', { url: 'https://example.com' });

    // Should have written to the custom stream
    expect(chunks.length).toBeGreaterThan(0);
    const payload = JSON.parse(chunks[0].trim());
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.method).toBe('autohand.mcp.invokeRequest');
    expect(payload.params.toolName).toBe('browser_navigate');
    expect(payload.params.input.url).toBe('https://example.com');

    // stdout must remain untouched
    const stdoutCalls = stdoutWriteSpy.mock.calls
      .map(c => String(c[0]))
      .filter(s => s.includes('jsonrpc'));
    expect(stdoutCalls).toHaveLength(0);

    promise.catch(() => {});
  });

  it('resolveBrowserToolResponse resolves the pending promise', async () => {
    const { invokeBrowserTool, resolveBrowserToolResponse, setBrowserBridgeOutput } = await import('../../src/browser/browserToolBridge.js');

    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, cb) { chunks.push(chunk.toString()); cb(); },
    });
    setBrowserBridgeOutput(sink);

    const promise = invokeBrowserTool('browser_click', { selector: '#btn' });

    // Extract the requestId from the written payload
    const payload = JSON.parse(chunks[0].trim());
    const requestId = payload.params.requestId;

    // Resolve it
    resolveBrowserToolResponse(requestId, true, 'Clicked!');

    const result = await promise;
    expect(result).toBe('Clicked!');
  });
});
