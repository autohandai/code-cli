/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression test: immediate-command slash/shell output must route through
 * writeAbove() when terminal regions are active (persistentInputActiveTurn).
 *
 * Bug: /repeat (and other slash commands executed from PersistentInput during
 * an active turn) used console.log() directly, which wrote on top of the
 * fixed input region, corrupting the UI.
 *
 * Fix: route through writeAbove() when terminal regions are active.
 */

// Import the routing helper we'll extract from agent.ts
import { routeOutput } from '../../src/core/immediateCommandRouter.js';

describe('immediateCommandRouter — routeOutput', () => {
  let originalConsoleLog: typeof console.log;
  let consoleLogCalls: string[];
  let writeAboveCalls: string[];
  let writeAbove: (text: string) => void;

  beforeEach(() => {
    originalConsoleLog = console.log;
    consoleLogCalls = [];
    writeAboveCalls = [];
    console.log = (...args: any[]) => consoleLogCalls.push(args.join(' '));
    writeAbove = (text: string) => writeAboveCalls.push(text);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    vi.restoreAllMocks();
  });

  it('routes through writeAbove when terminal regions are active', () => {
    routeOutput('Recurring job scheduled!\n  Job ID: abc123', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(writeAboveCalls).toHaveLength(1);
    expect(writeAboveCalls[0]).toContain('Recurring job scheduled!');
    expect(consoleLogCalls).toHaveLength(0);
  });

  it('falls back to console.log when persistentInputActiveTurn is false', () => {
    routeOutput('Recurring job scheduled!\n  Job ID: abc123', {
      persistentInputActiveTurn: false,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    expect(consoleLogCalls[0]).toContain('Recurring job scheduled!');
    expect(writeAboveCalls).toHaveLength(0);
  });

  it('falls back to console.log when terminal regions are disabled', () => {
    routeOutput('Recurring job scheduled!', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: true,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    expect(writeAboveCalls).toHaveLength(0);
  });

  it('handles empty string without crashing', () => {
    routeOutput('', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    // Empty message should still route, not crash
    expect(writeAboveCalls).toHaveLength(1);
    expect(consoleLogCalls).toHaveLength(0);
  });

  it('handles multi-line output (like /repeat confirmation)', () => {
    const multiLine = [
      'Recurring job scheduled!',
      '',
      '  Job ID:      c0e2ed90',
      '  Prompt:      tell me a joke about life',
      '  Cadence:     every 2 minutes',
      '  Cron:        */2 * * * *',
    ].join('\n');

    routeOutput(multiLine, {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(writeAboveCalls).toHaveLength(1);
    expect(writeAboveCalls[0]).toContain('Recurring job scheduled!');
    expect(writeAboveCalls[0]).toContain('c0e2ed90');
    expect(consoleLogCalls).toHaveLength(0);
  });
});
