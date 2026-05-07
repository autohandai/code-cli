/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: Composer must accept input after LLM response completes.
 *
 * Bug: The input guard in AgentUI's handleInput used `!isWorking || !enableQueueInput`
 * which blocked ALL text input when isWorking=false (idle state after LLM responds).
 * The correct guard is `isWorking && !enableQueueInput` — only block input when
 * the LLM is working AND queue-input is disabled.
 */

import { describe, it, expect } from 'vitest';

/**
 * Pure-function replica of the guard logic from AgentUI.tsx handleInput.
 * Extracted to test the boolean logic without needing Ink's useInput runtime.
 */
function shouldBlockInput(isWorking: boolean, enableQueueInput: boolean): boolean {
  // Block input only when working AND queue-input is disabled.
  // When idle (isWorking=false), always allow input.
  return isWorking && !enableQueueInput;
}

describe('Composer input guard after LLM response', () => {
  it('allows input when idle (isWorking=false) regardless of queue setting', () => {
    // After LLM responds, isWorking=false — user must be able to type
    expect(shouldBlockInput(false, true)).toBe(false);
    expect(shouldBlockInput(false, false)).toBe(false);
  });

  it('allows input when working and queue-input is enabled', () => {
    // User can queue next prompt while LLM is working
    expect(shouldBlockInput(true, true)).toBe(false);
  });

  it('blocks input when working and queue-input is disabled', () => {
    // LLM is working and queuing is off — block to prevent input conflicts
    expect(shouldBlockInput(true, false)).toBe(true);
  });

  it('OLD BUG: !isWorking || !enableQueueInput would block when idle', () => {
    // The old (buggy) guard: `!isWorking || !enableQueueInput`
    const oldGuard = (isWorking: boolean, enableQueueInput: boolean) =>
      !isWorking || !enableQueueInput;

    // When idle with queue enabled, old guard returned true (block) — BUG!
    expect(oldGuard(false, true)).toBe(true); // blocked! should be allowed
    // When idle with queue disabled, old guard also blocked
    expect(oldGuard(false, false)).toBe(true); // blocked! should be allowed
    // Only case old guard allowed: working + queue enabled
    expect(oldGuard(true, true)).toBe(false); // allowed (correct)
    // Working + queue disabled: blocked (correct)
    expect(oldGuard(true, false)).toBe(true); // blocked (correct)
  });
});

describe('AgentUI paste input ownership', () => {
  it('AgentUI does not wire the dead useBufferedInput hook', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/AgentUI.tsx'),
      'utf8',
    );

    expect(src.includes('useBufferedInput')).toBe(false);
    expect(src.includes('consumeInkBracketedPasteInput(char, pasteStateRef.current)')).toBe(true);
  });

  it('AgentUI source passes isActive={true} to InputLine so input is visible when idle', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/AgentUI.tsx'),
      'utf8',
    );

    // InputLine must be visible even when isWorking=false (idle)
    expect(src.includes('isActive={true}')).toBe(true);
    // Must NOT hide input when idle
    expect(src.includes('isActive={isWorking}')).toBe(false);
  });

  it('AgentUI does not wire shell command autocomplete into the composer', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/AgentUI.tsx'),
      'utf8',
    );

    expect(src.includes('ShellCommandDropdown')).toBe(false);
    expect(src.includes('buildShellCommandSuggestions')).toBe(false);
    expect(src.includes('shellCommandDropdown=')).toBe(false);
  });
});
