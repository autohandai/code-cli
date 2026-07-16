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

  it('refreshes dynamic extensions before reading tools and discovered agents', async () => {
    const events: string[] = [];
    const builder = createBuilder({
      refreshRuntimeExtensions: vi.fn(async () => {
        events.push('extensions');
      }),
      getToolDefinitions: () => {
        events.push('tools');
        return [];
      },
    });

    await builder.build();

    expect(events.slice(0, 2)).toEqual(['extensions', 'tools']);
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

  it('uses sysPrompt as a full replacement for project and agent-home instructions', async () => {
    const prompt = await createBuilder({
      runtime: {
        options: { sysPrompt: 'Custom profile replacement only' },
        workspaceRoot: process.cwd(),
        config: {},
      },
      loadInstructionFiles: vi.fn(async () => [
        '## Project Instructions (AGENTS.md)\nProject rules',
        '## Agent Profile Instructions ($AUTOHAND_HOME/AGENTS.md)\nProfile map',
      ]),
    }).build();

    expect(prompt).toBe('Custom profile replacement only');
    expect(prompt).not.toContain('Project rules');
    expect(prompt).not.toContain('Profile map');
  });

  it('appends appendSysPrompt after loaded project and agent profile instructions', async () => {
    const prompt = await createBuilder({
      runtime: {
        options: { appendSysPrompt: 'Additional launch metadata' },
        workspaceRoot: process.cwd(),
        config: {},
      },
      loadInstructionFiles: vi.fn(async () => [
        '## Project Instructions (AGENTS.md)\nProject rules',
        '## Agent Profile Instructions ($AUTOHAND_HOME/AGENTS.md)\nProfile map',
      ]),
    }).build();

    expect(prompt).toContain('Project rules');
    expect(prompt).toContain('Profile map');
    expect(prompt.endsWith('Additional launch metadata')).toBe(true);
  });

  it('bare mode omits implicit memories, discovered instructions, and discovered agents from the system prompt', async () => {
    const prompt = await createBuilder({
      runtime: {
        options: { bare: true },
        workspaceRoot: process.cwd(),
        config: {},
      },
      getContextMemories: vi.fn(async () => 'Remember prior project conventions.'),
      loadInstructionFiles: vi.fn(async () => [
        '## Project Instructions (AGENTS.md)\nProject rules',
      ]),
    }).build();

    expect(prompt).not.toContain('Remember prior project conventions.');
    expect(prompt).not.toContain('Project rules');
    expect(prompt).not.toContain('## Available Agents');
  });

  it('adds an Autohand override before Codex skill installer instructions', async () => {
    const codexInstallerBody = [
      'Install skills with the helper scripts.',
      'Installs into `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`).',
      'After installing a skill, tell the user: "Restart Codex to pick up new skills."',
    ].join('\n');

    const prompt = await createBuilder({
      listSkills: vi.fn(() => [
        {
          name: 'skill-installer',
          description: 'Install Codex skills',
          source: 'codex-user',
        },
      ]),
      getActiveSkills: vi.fn(() => [
        {
          name: 'skill-installer',
          description: 'Install Codex skills',
          source: 'codex-user',
          body: codexInstallerBody,
        },
      ]),
    }).build();

    const overrideIndex = prompt.indexOf('### Autohand Skill Compatibility Override');
    const originalBodyIndex = prompt.indexOf('Installs into `$CODEX_HOME/skills/<skill-name>`');

    expect(overrideIndex).toBeGreaterThan(-1);
    expect(originalBodyIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeLessThan(originalBodyIndex);
    expect(prompt).toContain('set `CODEX_HOME` to `$AUTOHAND_HOME`');
    expect(prompt).toContain('install user skills into `$AUTOHAND_HOME/skills`');
    expect(prompt).toContain('not `~/.codex/skills`');
    expect(prompt).toContain('Restart Autohand');
  });
});
