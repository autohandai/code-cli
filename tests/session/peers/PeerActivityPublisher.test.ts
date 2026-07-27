/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildActivity,
  derivePhase,
} from '../../../src/session/peers/PeerActivityPublisher.js';

const base = {
  isInstructionActive: true,
  awaitingInput: false,
  pathsWritten: [],
};

describe('derivePhase', () => {
  it('derives all five activity phases in precedence order', () => {
    expect(derivePhase({ ...base, isInstructionActive: false })).toBe('idle');
    expect(derivePhase({ ...base, awaitingInput: true, activeTool: 'run_command' }))
      .toBe('waiting_input');
    expect(derivePhase({ ...base, activeTool: 'run_command' })).toBe('running_command');
    expect(derivePhase({ ...base, activeTool: 'shell' })).toBe('running_command');
    expect(derivePhase({ ...base, activeTool: 'apply_patch' })).toBe('editing');
    expect(derivePhase({ ...base, activeTool: 'read_file' })).toBe('thinking');
  });
});

describe('buildActivity', () => {
  it('keeps the twenty newest unique paths', () => {
    const pathsWritten = Array.from({ length: 30 }, (_, index) => `src/f${index}.ts`);
    const activity = buildActivity({ ...base, pathsWritten });

    expect(activity.pathsWritten).toHaveLength(20);
    expect(activity.pathsWritten[0]).toBe('src/f0.ts');
    expect(activity.pathsWritten.at(-1)).toBe('src/f19.ts');
  });

  it('sanitizes and clamps peer-visible text', () => {
    const activity = buildActivity({
      ...base,
      instruction: `\u001b[2Jrefactor ${'x'.repeat(400)}`,
      command: 'git commit\u202Emoc.live',
    });

    expect(activity.instruction).not.toContain('\u001b');
    expect(Array.from(activity.instruction ?? '')).toHaveLength(200);
    expect(activity.command).not.toContain('\u202E');
  });

  it('omits empty optional fields and only publishes supplied claims', () => {
    expect(buildActivity(base)).toEqual({ phase: 'thinking', pathsWritten: [] });
    expect(buildActivity({ ...base, claims: ['src/a.ts'] }).claims).toEqual(['src/a.ts']);
  });
});
