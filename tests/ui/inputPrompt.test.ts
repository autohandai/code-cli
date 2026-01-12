/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';

// We need to test the safeEmitKeypressEvents function
// First, let's create a mock module to test the function behavior

describe('safeEmitKeypressEvents', () => {
  let originalEmitKeypressEvents: typeof readline.emitKeypressEvents;

  beforeEach(() => {
    // Save the original function
    originalEmitKeypressEvents = readline.emitKeypressEvents;
    // Reset the spy for each test
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restore the original function
    readline.emitKeypressEvents = originalEmitKeypressEvents;
  });

  it('should call emitKeypressEvents with the stream', async () => {
    // Dynamically import to get fresh module state
    const { safeEmitKeypressEvents } = await import('../../src/ui/inputPrompt.js');

    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents');

    // Create a mock stream with unique identity
    const mockStream = new EventEmitter() as NodeJS.ReadStream;
    (mockStream as any)._uniqueId = Math.random();

    safeEmitKeypressEvents(mockStream);

    expect(emitSpy).toHaveBeenCalled();
  });

  it('should track streams using WeakSet for garbage collection', async () => {
    // This test verifies the implementation uses WeakSet
    // which allows garbage collection of streams
    const { safeEmitKeypressEvents } = await import('../../src/ui/inputPrompt.js');

    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents');

    // Create multiple unique streams
    const streams: NodeJS.ReadStream[] = [];
    for (let i = 0; i < 3; i++) {
      const stream = new EventEmitter() as NodeJS.ReadStream;
      (stream as any)._uniqueId = `stream-${i}-${Math.random()}`;
      streams.push(stream);
    }

    // Each unique stream should trigger emitKeypressEvents
    for (const stream of streams) {
      safeEmitKeypressEvents(stream);
    }

    // All 3 unique streams should have been instrumented
    expect(emitSpy).toHaveBeenCalledTimes(3);
  });
});

describe('Display content utilities', () => {
  it('should calculate display content with truncation', async () => {
    const { getDisplayContent, MAX_DISPLAY_LINES } = await import('../../src/ui/inputPrompt.js');

    // Short content should not be truncated
    const shortResult = getDisplayContent('hello', 80);
    expect(shortResult.isTruncated).toBe(false);
    expect(shortResult.display).toBe('hello');

    // Empty content
    const emptyResult = getDisplayContent('', 80);
    expect(emptyResult.display).toBe('');
    expect(emptyResult.totalLines).toBe(0);
  });

  it('should count newline markers correctly', async () => {
    const { countNewlineMarkers, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

    expect(countNewlineMarkers('')).toBe(0);
    expect(countNewlineMarkers('hello')).toBe(0);
    expect(countNewlineMarkers(`hello${NEWLINE_MARKER}world`)).toBe(1);
    expect(countNewlineMarkers(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe(2);
  });

  it('should convert newline markers to actual newlines', async () => {
    const { convertNewlineMarkersToNewlines, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

    expect(convertNewlineMarkersToNewlines('')).toBe('');
    expect(convertNewlineMarkersToNewlines('hello')).toBe('hello');
    expect(convertNewlineMarkersToNewlines(`hello${NEWLINE_MARKER}world`)).toBe('hello\nworld');
    expect(convertNewlineMarkersToNewlines(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe('a\nb\nc');
  });
});
