/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../../src/core/toolManager.js';

describe('team task tool schemas', () => {
  it.each(['task_list', 'task_update'])('%s exposes every persisted task state', name => {
    const definition = DEFAULT_TOOL_DEFINITIONS.find(tool => tool.name === name);
    expect(definition?.parameters).toMatchObject({
      properties: { status: { enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] } },
    });
  });

  it('describes stop as cancellation, not retry', () => {
    expect(DEFAULT_TOOL_DEFINITIONS.find(tool => tool.name === 'task_stop')?.description).toContain('cancelled');
  });
});
