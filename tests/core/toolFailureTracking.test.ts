/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for per-tool consecutive failure tracking in the agent loop.
 * This prevents the LLM from retrying a failing tool with different arguments.
 */

import { describe, it, expect } from 'vitest';

/**
 * Simulates the per-tool failure tracking logic from agent.ts executeWithTools.
 * Extracted here for unit testing since the agent loop is not easily testable in isolation.
 */
function simulateToolFailureTracking(
  toolResults: Array<Array<{ tool: string; success: boolean; error?: string }>>,
  perToolFailureLimit: number
): { systemNotes: string[]; failureMap: Map<string, number> } {
  const toolConsecutiveFailures = new Map<string, number>();
  const systemNotes: string[] = [];

  for (const batch of toolResults) {
    for (const result of batch) {
      if (!result.success) {
        const count = (toolConsecutiveFailures.get(result.tool) ?? 0) + 1;
        toolConsecutiveFailures.set(result.tool, count);

        if (count >= perToolFailureLimit) {
          const errorSnippet = (result.error ?? '').slice(0, 200);
          systemNotes.push(
            `[Tool Failure Guard] The "${result.tool}" tool has failed ${count} times consecutively. ` +
            `Latest error: ${errorSnippet}\n` +
            `STOP using "${result.tool}". Do NOT retry it with different arguments.`
          );
        }
      } else {
        toolConsecutiveFailures.delete(result.tool);
      }
    }
  }

  return { systemNotes, failureMap: toolConsecutiveFailures };
}

describe('Per-tool consecutive failure tracking', () => {
  it('should not trigger system note on first failure', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo CAPTCHA' }]
      ],
      2
    );

    expect(result.systemNotes).toHaveLength(0);
    expect(result.failureMap.get('web_search')).toBe(1);
  });

  it('should trigger system note after 2 consecutive failures of same tool', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo CAPTCHA' }],
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo CAPTCHA' }]
      ],
      2
    );

    expect(result.systemNotes).toHaveLength(1);
    expect(result.systemNotes[0]).toContain('[Tool Failure Guard]');
    expect(result.systemNotes[0]).toContain('web_search');
    expect(result.systemNotes[0]).toContain('STOP');
  });

  it('should trigger on 2nd failure even when LLM uses different arguments', () => {
    // This is the exact bug scenario: LLM changes query each time
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo blocked with CAPTCHA' }],
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo blocked with CAPTCHA' }]
      ],
      2
    );

    expect(result.systemNotes).toHaveLength(1);
    expect(result.systemNotes[0]).toContain('web_search');
  });

  it('should reset failure count when tool succeeds', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'timeout' }],
        [{ tool: 'web_search', success: true }],
        [{ tool: 'web_search', success: false, error: 'timeout again' }]
      ],
      2
    );

    // After success, counter resets. Third call is only 1st failure after reset.
    expect(result.systemNotes).toHaveLength(0);
    expect(result.failureMap.get('web_search')).toBe(1);
  });

  it('should track different tools independently', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'CAPTCHA' }],
        [{ tool: 'read_file', success: false, error: 'not found' }],
        [{ tool: 'web_search', success: false, error: 'CAPTCHA again' }]
      ],
      2
    );

    // web_search has 2 failures, read_file has 1
    expect(result.systemNotes).toHaveLength(1);
    expect(result.systemNotes[0]).toContain('web_search');
    expect(result.failureMap.get('web_search')).toBe(2);
    expect(result.failureMap.get('read_file')).toBe(1);
  });

  it('should continue accumulating notes for each additional failure', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'CAPTCHA' }],
        [{ tool: 'web_search', success: false, error: 'CAPTCHA' }],
        [{ tool: 'web_search', success: false, error: 'CAPTCHA' }],
        [{ tool: 'web_search', success: false, error: 'CAPTCHA' }]
      ],
      2
    );

    // Notes on failures 2, 3, and 4
    expect(result.systemNotes).toHaveLength(3);
    expect(result.failureMap.get('web_search')).toBe(4);
  });

  it('should handle batch with mixed success/failure tools', () => {
    const result = simulateToolFailureTracking(
      [
        [
          { tool: 'read_file', success: true },
          { tool: 'web_search', success: false, error: 'blocked' }
        ],
        [
          { tool: 'web_search', success: false, error: 'still blocked' }
        ]
      ],
      2
    );

    expect(result.systemNotes).toHaveLength(1);
    expect(result.systemNotes[0]).toContain('web_search');
    expect(result.failureMap.has('read_file')).toBe(false); // deleted on success
  });

  it('should include error snippet in system note', () => {
    const result = simulateToolFailureTracking(
      [
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo blocked this search with a CAPTCHA challenge.' }],
        [{ tool: 'web_search', success: false, error: 'DuckDuckGo blocked this search with a CAPTCHA challenge.' }]
      ],
      2
    );

    expect(result.systemNotes[0]).toContain('DuckDuckGo blocked this search with a CAPTCHA challenge.');
  });
});
