/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SystemPromptBuilder } from '../../../src/core/agent/SystemPromptBuilder.js';

describe('SystemPromptBuilder', () => {
  it('includes the tool-choice rubric and runtime tool signatures', async () => {
    const builder = new SystemPromptBuilder({
      runtime: {
        options: {},
        workspaceRoot: process.cwd(),
        config: {},
      },
      getToolDefinitions: () => [{
        name: 'find',
        description: 'Find code, symbols, and matching context in the workspace',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text or pattern to find' },
          },
          required: ['query'],
        },
      }],
      getContextMemories: vi.fn(async () => ''),
      loadInstructionFiles: vi.fn(async () => []),
      listSkills: vi.fn(() => []),
      getActiveSkills: vi.fn(() => []),
      getTeam: vi.fn(() => null),
    });

    const prompt = await builder.build();

    expect(prompt).toContain('Prefer `fff_find`');
    expect(prompt).toContain('Prefer `fff_grep`');
    expect(prompt).toContain('Use `read_file` after search identifies the exact file or region you need.');
    expect(prompt).toContain('Legacy find: `find(query="buildSystemPrompt", mode="exact")`');
    expect(prompt).toContain('find(query: string)');
    expect(prompt).toContain('Reflect Before Acting');
  });
});
