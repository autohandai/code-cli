/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SystemPromptBuilder } from '../../../src/core/agent/SystemPromptBuilder.js';

describe('SystemPromptBuilder', () => {
  it('includes the tool-choice rubric and compact tool catalog without runtime schemas', async () => {
    const builder = new SystemPromptBuilder({
      runtime: {
        options: {},
        workspaceRoot: process.cwd(),
        config: {},
      },
      getToolDefinitions: () => [{
        name: 'fff_grep',
        description: 'Search code, symbols, and matching context in the workspace',
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

    expect(prompt).toContain('Use `fff_find` for file path discovery.');
    expect(prompt).toContain('Use `fff_grep` for content/code discovery.');
    expect(prompt).toContain('Use `read_file` after search identifies the exact file or region you need.');
    expect(prompt).not.toContain('Legacy find:');
    expect(prompt).toContain('### Tool Capability Catalog');
    expect(prompt).toContain('fff_grep');
    expect(prompt).not.toContain('fff_grep(query: string)');
    expect(prompt).not.toContain('Text or pattern to find');
    expect(prompt).toContain('Exact tool schemas are selected per request');
    expect(prompt).toContain('Reflect Before Acting');
    expect(prompt).toContain('Write code using `apply_patch`');
    expect(prompt).not.toContain('multi_file_edit');
  });
});
