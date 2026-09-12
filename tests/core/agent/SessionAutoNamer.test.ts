/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { deriveSessionTitleFromInstruction, sanitizeModelTitle, SessionAutoNamer } from '../../../src/core/agent/SessionAutoNamer.js';

describe('deriveSessionTitleFromInstruction', () => {
  it('turns the first words of a prompt into a short capitalised name', () => {
    expect(deriveSessionTitleFromInstruction('fix the caret after startup when typing fast')).toBe('Fix the caret after startup when typing');
    expect(deriveSessionTitleFromInstruction('  add   @src/index.ts to the $brainstorm plan\n')).toBe('Add to the plan');
    expect(deriveSessionTitleFromInstruction('Investigate `bun run proof` failures at https://ci.example')).toBe('Investigate failures at');
  });

  it('ignores commands, shell lines, agent messages, and content without letters', () => {
    expect(deriveSessionTitleFromInstruction('/rename x')).toBeUndefined();
    expect(deriveSessionTitleFromInstruction('!git status')).toBeUndefined();
    expect(deriveSessionTitleFromInstruction(':reviewer hi')).toBeUndefined();
    expect(deriveSessionTitleFromInstruction('#remember this')).toBeUndefined();
    expect(deriveSessionTitleFromInstruction('12345 !!!')).toBeUndefined();
    expect(deriveSessionTitleFromInstruction('   ')).toBeUndefined();
  });

  it('caps the length on a word boundary', () => {
    const title = deriveSessionTitleFromInstruction('reorganise the extraordinarily complicated internationalisation subsystem thoroughly today');
    expect(title!.length).toBeLessThanOrEqual(48);
    expect(title).toBe('Reorganise the extraordinarily complicated');
  });
});

describe('sanitizeModelTitle', () => {
  it('strips labels, quotes, and trailing punctuation', () => {
    expect(sanitizeModelTitle('Name: "Fix caret after startup."')).toBe('Fix caret after startup');
    expect(sanitizeModelTitle('  Add session rename command\nextra')).toBe('Add session rename command');
  });

  it('rejects empty, wordy, or letterless replies', () => {
    expect(sanitizeModelTitle('')).toBeNull();
    expect(sanitizeModelTitle('one two three four five six seven eight nine')).toBeNull();
    expect(sanitizeModelTitle('1234')).toBeNull();
  });
});

describe('SessionAutoNamer.refine', () => {
  const history = [
    { role: 'user' as const, content: 'fix the caret after startup' },
    { role: 'assistant' as const, content: 'The caret was hidden by a fake working state; fixed.' },
  ];

  it('asks the model with a tiny budget and returns the sanitised name', async () => {
    const complete = vi.fn().mockResolvedValue({ content: '"Fix caret after startup"' });
    const namer = new SessionAutoNamer({ enabled: true, getProvider: () => ({ complete } as never) });
    expect(await namer.refine(history)).toBe('Fix caret after startup');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 24, temperature: 0.2 }));
    expect(complete.mock.calls[0][0].messages[1].content).toContain('user: fix the caret after startup');
  });

  it('returns null when disabled, without a provider, on failure, or on timeout', async () => {
    expect(await new SessionAutoNamer({ enabled: false, getProvider: () => ({ complete: vi.fn() } as never) }).refine(history)).toBeNull();
    expect(await new SessionAutoNamer({ enabled: true, getProvider: () => null }).refine(history)).toBeNull();
    const failing = new SessionAutoNamer({ enabled: true, getProvider: () => ({ complete: vi.fn().mockRejectedValue(new Error('boom')) } as never) });
    expect(await failing.refine(history)).toBeNull();
    const slow = new SessionAutoNamer({
      enabled: true, timeoutMs: 20,
      getProvider: () => ({ complete: (request: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }) } as never),
    });
    expect(await slow.refine(history)).toBeNull();
  });
});
