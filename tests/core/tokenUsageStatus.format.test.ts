/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildHostTokenUsageContextStatus,
  buildHostTokenUsageStatus,
  formatCompactTokens,
  formatTokenUsageContextStatus,
  formatTokenUsageStatus,
} from '../../src/core/agent/AgentFormatter.js';
import type { LoadedConfig } from '../../src/types.js';

describe('formatCompactTokens', () => {
  it('renders sub-thousand counts as integers', () => {
    expect(formatCompactTokens(0)).toBe('0');
    expect(formatCompactTokens(42)).toBe('42');
    expect(formatCompactTokens(999)).toBe('999');
  });

  it('renders thousands with a lowercase k and one decimal', () => {
    expect(formatCompactTokens(15_700)).toBe('15.7k');
    expect(formatCompactTokens(3_200)).toBe('3.2k');
    expect(formatCompactTokens(262_144)).toBe('262.1k');
  });

  it('renders millions with an uppercase M and one decimal', () => {
    expect(formatCompactTokens(1_050_000)).toBe('1.1M');
    expect(formatCompactTokens(2_000_000)).toBe('2.0M');
  });

  it('treats negative or non-finite input as zero', () => {
    expect(formatCompactTokens(-5)).toBe('0');
    expect(formatCompactTokens(Number.NaN)).toBe('0');
  });
});

describe('formatTokenUsageStatus', () => {
  it('matches the requested up/down + context layout', () => {
    const output = formatTokenUsageStatus({
      promptTokens: 15_700,
      completionTokens: 3_200,
      contextTokens: 15_700,
      contextWindow: 262_144,
    });
    expect(output).toBe('↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)');
  });

  it('omits the context segment when the window is unknown', () => {
    expect(
      formatTokenUsageStatus({
        promptTokens: 15_700,
        completionTokens: 3_200,
        contextTokens: 15_700,
        contextWindow: 0,
      })
    ).toBe('↑15.7k ↓3.2k');
  });

  it('clamps the context percentage to 100', () => {
    const output = formatTokenUsageStatus({
      promptTokens: 300_000,
      completionTokens: 0,
      contextTokens: 300_000,
      contextWindow: 262_144,
    });
    expect(output).toContain('100.0%');
  });

  it('reports unavailable when usage is not actual', () => {
    expect(
      formatTokenUsageStatus({
        promptTokens: 0,
        completionTokens: 0,
        contextTokens: 0,
        contextWindow: 262_144,
        unavailable: true,
      })
    ).toBe('unavailable');
  });
});

describe('formatTokenUsageContextStatus', () => {
  it('renders the same context segment used by the token usage status', () => {
    const output = formatTokenUsageContextStatus({
      promptTokens: 19_300,
      completionTokens: 124,
      contextTokens: 19_300,
      contextWindow: 262_144,
    });

    expect(output).toBe('context: 7.4% (19.3k/262.1k)');
  });

  it('returns null when context usage is unavailable or incomplete', () => {
    expect(
      formatTokenUsageContextStatus({
        promptTokens: 19_300,
        completionTokens: 124,
        contextTokens: 19_300,
        contextWindow: 0,
      })
    ).toBeNull();
    expect(
      formatTokenUsageContextStatus({
        promptTokens: 19_300,
        completionTokens: 124,
        contextTokens: 19_300,
        contextWindow: 262_144,
        unavailable: true,
      })
    ).toBeNull();
  });
});

describe('buildHostTokenUsageStatus', () => {
  const host = {
    runtime: { config: undefined as LoadedConfig | undefined },
    contextWindow: 262_144,
    sessionPromptTokens: 15_700,
    sessionCompletionTokens: 3_200,
    lastContextTokens: 15_700,
  };

  function withFlag(enabled: boolean) {
    return {
      ...host,
      runtime: {
        config: { configPath: '/tmp/c.json', features: { tokenUsageStatus: enabled } } as unknown as LoadedConfig,
      },
    };
  }

  it('returns null when the feature flag is disabled', () => {
    expect(buildHostTokenUsageStatus(withFlag(false), false)).toBeNull();
    expect(buildHostTokenUsageStatus(host, false)).toBeNull();
  });

  it('returns the formatted status when the flag is enabled', () => {
    expect(buildHostTokenUsageStatus(withFlag(true), false)).toBe(
      '↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)'
    );
  });

  it('propagates the unavailable flag', () => {
    expect(buildHostTokenUsageStatus(withFlag(true), true)).toBe('unavailable');
  });

  it('returns the context segment used by the status line when available', () => {
    expect(buildHostTokenUsageContextStatus(withFlag(true), false)).toBe(
      'context: 6.0% (15.7k/262.1k)'
    );
  });
});
