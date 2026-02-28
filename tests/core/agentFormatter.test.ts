/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { formatToolResultsBatch } from '../../src/core/agent/AgentFormatter.js';

describe('formatToolResultsBatch thought display', () => {
  const successResult = { tool: 'read_file' as any, success: true, output: 'file contents here' };

  it('displays thought text before tool results', () => {
    const output = formatToolResultsBatch([successResult], 300, [], 'Analyzing the code structure...');
    expect(output).toContain('Analyzing the code structure...');
  });

  it('no longer filters thoughts that were extracted from JSON', () => {
    // After the fix, thoughts are already extracted from JSON by
    // parseAssistantReactPayload, so they should be displayed even
    // if the original JSON started with {
    const thought = 'The user wants to understand the codebase';
    const output = formatToolResultsBatch([successResult], 300, [], thought);
    expect(output).toContain(thought);
  });

  it('omits thought when null/undefined', () => {
    const output = formatToolResultsBatch([successResult], 300, [], undefined);
    // Should only contain tool output, not any thought line
    expect(output).toContain('read_file');
    expect(output).not.toContain('undefined');
  });
});
