/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { SystemPromptBuilder } from '../../../src/core/agent/SystemPromptBuilder.js';

describe('SystemPromptBuilder', () => {
  function createBuilder(overrides: Partial<ConstructorParameters<typeof SystemPromptBuilder>[0]> = {}) {
    return new SystemPromptBuilder({
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
      ...overrides,
    });
  }

  it('includes the tool-choice rubric and compact tool catalog without runtime schemas', async () => {
    const builder = createBuilder();

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

  it('keeps the JSON toolCalls protocol for providers without native tool calling', async () => {
    const prompt = await createBuilder({
      supportsNativeToolCalling: false,
    }).build();

    expect(prompt).toContain('Always reply with structured JSON:');
    expect(prompt).toContain('"toolCalls": [{"tool": "tool_name", "args": {...}}]');
    expect(prompt).toContain('PUT THE TOOL CALL IN toolCalls');
    expect(prompt).toContain('include ALL of them in a single toolCalls array');
  });

  it('uses a native-tool prompt contract for providers with native tool calling', async () => {
    const prompt = await createBuilder({
      supportsNativeToolCalling: true,
    }).build();

    expect(prompt).toContain('### Response Format');
    expect(prompt).toContain('Use the provider-native tool calling interface whenever you need to inspect files, run commands, or make changes.');
    expect(prompt).toContain('Do not encode tool calls in JSON, XML, markdown, or prose.');
    expect(prompt).toContain('Parallel independent native tool calls are encouraged');
    expect(prompt).not.toContain('Always reply with structured JSON:');
    expect(prompt).not.toContain('"toolCalls": [{"tool": "tool_name", "args": {...}}]');
    expect(prompt).not.toContain('PUT THE TOOL CALL IN toolCalls');
  });

  it('only includes persistent goal guidance when slash_goal is enabled', async () => {
    const disabledPrompt = await createBuilder().build();
    const enabledPrompt = await createBuilder({
      runtime: {
        options: {},
        workspaceRoot: process.cwd(),
        config: {
          configPath: '/tmp/autohand-config.json',
          features: { slashGoal: true },
        },
      },
    }).build();

    expect(disabledPrompt).not.toContain('### Persistent Goals');
    expect(enabledPrompt).toContain('### Persistent Goals');
    expect(enabledPrompt).toContain('create_goal');
  });

  it('includes completion report guidance by default', async () => {
    const prompt = await createBuilder().build();

    expect(prompt).toContain('## Completion Report');
    expect(prompt).toContain('For code work, include the details a staff engineer would expect');
    expect(prompt).toContain('SITREP:');
  });

  it('omits completion report guidance when disabled in config', async () => {
    const prompt = await createBuilder({
      runtime: {
        options: {},
        workspaceRoot: process.cwd(),
        config: {
          configPath: '/tmp/autohand-config.json',
          ui: { completionReportEnabled: false },
        },
      },
    }).build();

    expect(prompt).not.toContain('## Completion Report');
    expect(prompt).not.toContain('SITREP:');
  });
});
