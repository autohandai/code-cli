/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatComposerToolCallStatus } from '../../../src/core/agent/ReactLoopRunner.js';

describe('ReactLoopRunner composer status', () => {
  it('does not include model-provided tool names in composer status', () => {
    expect(formatComposerToolCallStatus(1)).toBe('Calling tool...');
    expect(formatComposerToolCallStatus(3)).toBe('Calling 3 tools...');
  });

  it('does not interpolate model thought text into Ink status updates', () => {
    const source = readFileSync('src/core/agent/ReactLoopRunner.ts', 'utf-8');

    expect(source).not.toContain('Thinking: ${thoughtPreview}');
    expect(source).not.toContain('Calling: ${toolNames}');
  });
});
