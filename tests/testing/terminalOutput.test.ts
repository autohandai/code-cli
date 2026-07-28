/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { hasTerminalProcessPid } from '../../src/testing/assertions/terminalOutput.js';

describe('terminal output assertions', () => {
  it('matches a process pid when the terminal wraps between the label and value', () => {
    const screen = [
      'Background processes:',
      '1  node task.js  (pid',
      '11482, running 0m00s)',
    ].join('\n');

    expect(hasTerminalProcessPid(screen, 11482)).toBe(true);
    expect(hasTerminalProcessPid(screen, 1148)).toBe(false);
  });
});
