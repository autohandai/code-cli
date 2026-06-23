/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { parseAgentSlashCommand } from '../../../src/core/agent/AgentCommandRuntime.js';

describe('parseAgentSlashCommand', () => {
  it('parses /handoff session as a two-word command', () => {
    const parsed = parseAgentSlashCommand({} as never, '/handoff session --queue');

    expect(parsed).toEqual({
      command: '/handoff session',
      args: ['--queue'],
    });
  });
});
