import { describe, expect, it } from 'vitest';
import { describeNetworkTimeout } from '../../src/utils/networkTimeout.js';
import en from '../../src/i18n/locales/en.json';

describe('active provider timeout wording', () => {
  it.each([
    ['autohandai', 300], ['anthropic', 600], ['openrouter', 30], ['azure', 30],
    ['vertexai', 30], ['cerebras', 30], ['nvidia', 30], ['llmgateway', 30],
    ['zai', 30], ['sakana', 30], ['deepseek', 30], ['mlx', 60], ['ollama', 120],
  ] as const)('shows the %s provider default', (provider, seconds) => {
    expect(describeNetworkTimeout({ provider })).toBe(`provider default (${seconds} s)`);
  });
  it('uses OpenRouter when no provider is set and handles custom compatible providers', () => {
    expect(describeNetworkTimeout()).toBe('provider default (30 s)');
    expect(describeNetworkTimeout({ provider: 'custom:fixture' })).toBe('provider default (30 s)');
  });
  it.each(['openai', 'xai', 'llamacpp', 'bedrock'] as const)('does not invent a network deadline for %s, which ignores network settings', provider => {
    expect(describeNetworkTimeout({ provider, network: { timeout: 5000 } })).toBe('provider default');
  });
  it.each([
    ['anthropic', 30000, '600 s (set to 30 s, raised by the provider)'],
    ['autohandai', 5000, '300 s (set to 5 s, raised by the provider)'],
    ['anthropic', 700000, '700 s'], ['openrouter', 5500, '5.5 s'],
  ] as const)('shows the effective %s budget for %d ms', (provider, timeout, expected) => {
    expect(describeNetworkTimeout({ provider, network: { timeout } })).toBe(expected);
  });
  it('retains the approved wizard and settings help verbatim', () => {
    expect(en.setup.network.timeout).toBe('Leave blank for the provider default, or enter 5000-600000 ms');
    expect(en.commands.settings.network.timeoutDesc).toBe("Leave blank to use each provider's default, for example 300 s for Autohand and at least 600 s for Anthropic.");
  });
});
