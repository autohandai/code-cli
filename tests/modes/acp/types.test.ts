/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_KIND_MAP,
  TOOL_DISPLAY_NAMES,
  DEFAULT_ACP_COMMANDS,
  DEFAULT_ACP_MODES,
  resolveToolKind,
  resolveToolDisplayName,
  buildConfigOptions,
  parseAvailableModels,
  resolveDefaultMode,
  resolveDefaultModel,
} from '../../../src/modes/acp/types.js';
import type { LoadedConfig } from '../../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/test-config.json',
    provider: 'openrouter',
    openrouter: {
      apiKey: 'sk-test',
      model: 'anthropic/claude-3.5-sonnet',
    },
    ...overrides,
  } as LoadedConfig;
}

// ===========================================================================
// TOOL_KIND_MAP
// ===========================================================================

describe('TOOL_KIND_MAP', () => {
  it('contains expected read tools with ToolKind "read"', () => {
    expect(TOOL_KIND_MAP['read_file']).toBe('read');
    expect(TOOL_KIND_MAP['list_tree']).toBe('read');
    expect(TOOL_KIND_MAP['list_directory']).toBe('read');
    expect(TOOL_KIND_MAP['file_stats']).toBe('read');
    expect(TOOL_KIND_MAP['file_info']).toBe('read');
    expect(TOOL_KIND_MAP['project_info']).toBe('read');
    expect(TOOL_KIND_MAP['workspace_info']).toBe('read');
    expect(TOOL_KIND_MAP['dependency_list']).toBe('read');
  });

  it('contains expected search tools with ToolKind "search"', () => {
    expect(TOOL_KIND_MAP['search']).toBe('search');
    expect(TOOL_KIND_MAP['search_files']).toBe('search');
    expect(TOOL_KIND_MAP['search_with_context']).toBe('search');
    expect(TOOL_KIND_MAP['semantic_search']).toBe('search');
  });

  it('contains expected edit tools with ToolKind "edit"', () => {
    expect(TOOL_KIND_MAP['write_file']).toBe('edit');
    expect(TOOL_KIND_MAP['apply_patch']).toBe('edit');
    expect(TOOL_KIND_MAP['replace_in_file']).toBe('edit');
    expect(TOOL_KIND_MAP['create_directory']).toBe('edit');
  });

  it('contains expected execute tools with ToolKind "execute"', () => {
    expect(TOOL_KIND_MAP['run_command']).toBe('execute');
    expect(TOOL_KIND_MAP['custom_command']).toBe('execute');
    expect(TOOL_KIND_MAP['git_status']).toBe('execute');
    expect(TOOL_KIND_MAP['git_commit']).toBe('execute');
  });

  it('contains move and delete tool kinds', () => {
    expect(TOOL_KIND_MAP['rename_path']).toBe('move');
    expect(TOOL_KIND_MAP['delete_path']).toBe('delete');
  });

  it('contains fetch tool kinds for web operations', () => {
    expect(TOOL_KIND_MAP['web_search']).toBe('fetch');
    expect(TOOL_KIND_MAP['web_repo']).toBe('fetch');
  });

  it('contains think tool kinds', () => {
    expect(TOOL_KIND_MAP['todo_write']).toBe('think');
    expect(TOOL_KIND_MAP['plan']).toBe('think');
    expect(TOOL_KIND_MAP['thinking']).toBe('think');
    expect(TOOL_KIND_MAP['smart_context_cropper']).toBe('think');
  });

  it('contains other tool kinds', () => {
    expect(TOOL_KIND_MAP['save_memory']).toBe('other');
    expect(TOOL_KIND_MAP['recall_memory']).toBe('other');
    expect(TOOL_KIND_MAP['tools_registry']).toBe('other');
  });
});

// ===========================================================================
// TOOL_DISPLAY_NAMES
// ===========================================================================

describe('TOOL_DISPLAY_NAMES', () => {
  it('has a display name for every entry in TOOL_KIND_MAP', () => {
    for (const toolName of Object.keys(TOOL_KIND_MAP)) {
      expect(TOOL_DISPLAY_NAMES).toHaveProperty(toolName);
      expect(typeof TOOL_DISPLAY_NAMES[toolName]).toBe('string');
      expect(TOOL_DISPLAY_NAMES[toolName].length).toBeGreaterThan(0);
    }
  });

  it('maps known tools to correct display names', () => {
    expect(TOOL_DISPLAY_NAMES['read_file']).toBe('Read');
    expect(TOOL_DISPLAY_NAMES['write_file']).toBe('Write');
    expect(TOOL_DISPLAY_NAMES['run_command']).toBe('Run');
    expect(TOOL_DISPLAY_NAMES['git_status']).toBe('Git Status');
    expect(TOOL_DISPLAY_NAMES['delete_path']).toBe('Delete');
    expect(TOOL_DISPLAY_NAMES['apply_patch']).toBe('Patch');
    expect(TOOL_DISPLAY_NAMES['dependency_add']).toBe('Add Dep');
  });
});

// ===========================================================================
// DEFAULT_ACP_COMMANDS
// ===========================================================================

describe('DEFAULT_ACP_COMMANDS', () => {
  it('has exactly 24 commands', () => {
    expect(DEFAULT_ACP_COMMANDS).toHaveLength(24);
  });

  it('each command has name and description strings', () => {
    for (const cmd of DEFAULT_ACP_COMMANDS) {
      expect(typeof cmd.name).toBe('string');
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe('string');
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it('includes well-known commands', () => {
    const names = DEFAULT_ACP_COMMANDS.map((c) => c.name);
    expect(names).toContain('help');
    expect(names).toContain('new');
    expect(names).toContain('model');
    expect(names).toContain('mode');
    expect(names).toContain('undo');
    expect(names).toContain('resume');
    expect(names).toContain('sessions');
    expect(names).toContain('memory');
    expect(names).toContain('feedback');
    expect(names).toContain('agents');
    expect(names).toContain('automode');
    expect(names).toContain('lint');
  });
});

// ===========================================================================
// DEFAULT_ACP_MODES
// ===========================================================================

describe('DEFAULT_ACP_MODES', () => {
  it('has exactly 6 modes', () => {
    expect(DEFAULT_ACP_MODES).toHaveLength(6);
  });

  it('has the correct mode IDs in order', () => {
    const ids = DEFAULT_ACP_MODES.map((m) => m.id);
    expect(ids).toEqual([
      'interactive',
      'full-access',
      'unrestricted',
      'auto-mode',
      'restricted',
      'dry-run',
    ]);
  });

  it('each mode has id, name, and description strings', () => {
    for (const mode of DEFAULT_ACP_MODES) {
      expect(typeof mode.id).toBe('string');
      expect(mode.id.length).toBeGreaterThan(0);
      expect(typeof mode.name).toBe('string');
      expect(mode.name.length).toBeGreaterThan(0);
      expect(typeof mode.description).toBe('string');
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// resolveToolKind()
// ===========================================================================

describe('resolveToolKind()', () => {
  it('returns correct kind for known tools', () => {
    expect(resolveToolKind('read_file')).toBe('read');
    expect(resolveToolKind('search')).toBe('search');
    expect(resolveToolKind('write_file')).toBe('edit');
    expect(resolveToolKind('rename_path')).toBe('move');
    expect(resolveToolKind('delete_path')).toBe('delete');
    expect(resolveToolKind('run_command')).toBe('execute');
    expect(resolveToolKind('thinking')).toBe('think');
    expect(resolveToolKind('save_memory')).toBe('other');
    expect(resolveToolKind('web_search')).toBe('fetch');
  });

  it('returns "execute" for mcp__ prefixed tools', () => {
    expect(resolveToolKind('mcp__my_server__my_tool')).toBe('execute');
    expect(resolveToolKind('mcp__fs__readFile')).toBe('execute');
    expect(resolveToolKind('mcp__context7__query-docs')).toBe('execute');
  });

  it('returns "other" for unknown tools', () => {
    expect(resolveToolKind('totally_unknown_tool')).toBe('other');
    expect(resolveToolKind('foo_bar_baz')).toBe('other');
    expect(resolveToolKind('')).toBe('other');
  });
});

// ===========================================================================
// resolveToolDisplayName()
// ===========================================================================

describe('resolveToolDisplayName()', () => {
  it('returns correct name for known tools', () => {
    expect(resolveToolDisplayName('read_file')).toBe('Read');
    expect(resolveToolDisplayName('write_file')).toBe('Write');
    expect(resolveToolDisplayName('git_status')).toBe('Git Status');
    expect(resolveToolDisplayName('dependency_add')).toBe('Add Dep');
    expect(resolveToolDisplayName('plan')).toBe('Plan');
  });

  it('returns formatted MCP name for mcp__ prefixed tools', () => {
    expect(resolveToolDisplayName('mcp__my_server__my_tool')).toBe('MCP: my_server/my_tool');
    expect(resolveToolDisplayName('mcp__context7__query-docs')).toBe('MCP: context7/query-docs');
  });

  it('handles MCP tools with multiple double-underscore segments', () => {
    expect(resolveToolDisplayName('mcp__srv__a__b')).toBe('MCP: srv/a/b');
  });

  it('returns Title Case for unknown snake_case tools', () => {
    expect(resolveToolDisplayName('some_unknown_tool')).toBe('Some Unknown Tool');
    expect(resolveToolDisplayName('foo_bar')).toBe('Foo Bar');
  });

  it('handles single-word unknown tools', () => {
    expect(resolveToolDisplayName('magic')).toBe('Magic');
  });
});

// ===========================================================================
// buildConfigOptions()
// ===========================================================================

describe('buildConfigOptions()', () => {
  it('returns an array of SessionConfigOption objects', () => {
    const config = makeConfig();
    const options = buildConfigOptions(config);

    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBe(3);
  });

  it('includes thinking_level option', () => {
    const options = buildConfigOptions(makeConfig());
    const thinking = options.find((o) => o.id === 'thinking_level');

    expect(thinking).toBeDefined();
    expect(thinking!.type).toBe('select');
    expect(thinking!.name).toBe('Thinking Level');
    expect(thinking!.currentValue).toBe('normal');
  });

  it('includes auto_commit option', () => {
    const options = buildConfigOptions(makeConfig());
    const autoCommit = options.find((o) => o.id === 'auto_commit');

    expect(autoCommit).toBeDefined();
    expect(autoCommit!.type).toBe('select');
    expect(autoCommit!.name).toBe('Auto Commit');
    expect(autoCommit!.currentValue).toBe('off');
  });

  it('includes context_compact option', () => {
    const options = buildConfigOptions(makeConfig());
    const compact = options.find((o) => o.id === 'context_compact');

    expect(compact).toBeDefined();
    expect(compact!.type).toBe('select');
    expect(compact!.name).toBe('Context Compaction');
    expect(compact!.currentValue).toBe('on');
  });
});

// ===========================================================================
// parseAvailableModels()
// ===========================================================================

describe('parseAvailableModels()', () => {
  it('returns a list including popular models', () => {
    const config = makeConfig();
    const models = parseAvailableModels(config);

    expect(models).toContain('anthropic/claude-sonnet-4-20250514');
    expect(models).toContain('anthropic/claude-3.5-sonnet');
    expect(models).toContain('openai/gpt-4o');
    expect(models).toContain('google/gemini-2.0-flash-001');
    expect(models).toContain('deepseek/deepseek-chat-v3-0324');
  });

  it('places the configured model first when it exists', () => {
    const config = makeConfig({
      openrouter: { apiKey: 'sk-test', model: 'anthropic/claude-3.5-sonnet' },
    });
    const models = parseAvailableModels(config);

    expect(models[0]).toBe('anthropic/claude-3.5-sonnet');
  });

  it('does not duplicate the configured model if it is in the popular list', () => {
    const config = makeConfig({
      openrouter: { apiKey: 'sk-test', model: 'anthropic/claude-3.5-sonnet' },
    });
    const models = parseAvailableModels(config);
    const occurrences = models.filter((m) => m === 'anthropic/claude-3.5-sonnet');

    expect(occurrences).toHaveLength(1);
  });

  it('adds a custom configured model that is not in the popular list', () => {
    const config = makeConfig({
      openrouter: { apiKey: 'sk-test', model: 'custom/my-model-v1' },
    });
    const models = parseAvailableModels(config);

    expect(models[0]).toBe('custom/my-model-v1');
    expect(models.length).toBeGreaterThan(5);
  });

  it('handles config without provider model gracefully', () => {
    const config = makeConfig({ provider: undefined, openrouter: undefined } as any);
    const models = parseAvailableModels(config);

    // Should still contain the popular models
    expect(models.length).toBeGreaterThanOrEqual(5);
  });
});

// ===========================================================================
// resolveDefaultMode()
// ===========================================================================

describe('resolveDefaultMode()', () => {
  it('returns "interactive" when config is undefined', () => {
    expect(resolveDefaultMode(undefined)).toBe('interactive');
  });

  it('returns "interactive" when permissions.mode is not set', () => {
    const config = makeConfig();
    expect(resolveDefaultMode(config)).toBe('interactive');
  });

  it('returns "unrestricted" when permissions.mode is "unrestricted"', () => {
    const config = makeConfig({ permissions: { mode: 'unrestricted' } });
    expect(resolveDefaultMode(config)).toBe('unrestricted');
  });

  it('returns "restricted" when permissions.mode is "restricted"', () => {
    const config = makeConfig({ permissions: { mode: 'restricted' } });
    expect(resolveDefaultMode(config)).toBe('restricted');
  });

  it('returns "interactive" for other permission modes', () => {
    const config = makeConfig({ permissions: { mode: 'interactive' } });
    expect(resolveDefaultMode(config)).toBe('interactive');
  });
});

// ===========================================================================
// resolveDefaultModel()
// ===========================================================================

describe('resolveDefaultModel()', () => {
  it('returns model from config provider settings', () => {
    const config = makeConfig({
      provider: 'openrouter',
      openrouter: { apiKey: 'sk-test', model: 'anthropic/claude-3.5-sonnet' },
    });

    expect(resolveDefaultModel(config)).toBe('anthropic/claude-3.5-sonnet');
  });

  it('returns model for non-openrouter providers', () => {
    const config = makeConfig({
      provider: 'ollama',
      ollama: { model: 'llama3.2:latest', baseUrl: 'http://localhost:11434' },
    } as any);

    expect(resolveDefaultModel(config)).toBe('llama3.2:latest');
  });

  it('returns fallback model when provider config has no model', () => {
    const config = makeConfig({ openrouter: undefined } as any);

    expect(resolveDefaultModel(config)).toBe('anthropic/claude-3.5-sonnet');
  });

  it('defaults to openrouter when provider is not specified', () => {
    const config = makeConfig({
      provider: undefined,
      openrouter: { apiKey: 'sk-test', model: 'openai/gpt-4o' },
    });

    expect(resolveDefaultModel(config)).toBe('openai/gpt-4o');
  });
});
