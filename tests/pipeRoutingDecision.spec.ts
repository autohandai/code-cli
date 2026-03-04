/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { shouldUseInteractivePipeHandoff } from '../src/modes/pipeRouting.js';

describe('shouldUseInteractivePipeHandoff', () => {
  it('returns false when stdout is not a TTY', () => {
    expect(
      shouldUseInteractivePipeHandoff({
        pipedInput: 'hello',
        hasExplicitPromptFlag: false,
        hasPromptText: false,
        stdoutIsTTY: false,
      })
    ).toBe(false);
  });

  it('returns true for stdin-only pipe when stdout is interactive', () => {
    expect(
      shouldUseInteractivePipeHandoff({
        pipedInput: 'hello',
        hasExplicitPromptFlag: false,
        hasPromptText: false,
        stdoutIsTTY: true,
      })
    ).toBe(true);
  });

  it('returns false when prompt text is provided', () => {
    expect(
      shouldUseInteractivePipeHandoff({
        pipedInput: 'hello',
        hasExplicitPromptFlag: false,
        hasPromptText: true,
        stdoutIsTTY: true,
      })
    ).toBe(false);
  });

  it('returns false when -p/--prompt flag is explicitly present', () => {
    expect(
      shouldUseInteractivePipeHandoff({
        pipedInput: 'hello',
        hasExplicitPromptFlag: true,
        hasPromptText: false,
        stdoutIsTTY: true,
      })
    ).toBe(false);
  });
});

