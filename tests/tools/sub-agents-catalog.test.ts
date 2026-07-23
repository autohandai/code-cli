/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import { filterToolsByRelevance } from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';
import {
  installSubAgentFromCatalog,
  searchSubAgentsCatalog,
} from '../../src/actions/subAgentsCatalog.js';

/**
 * Fixture mirrors the live autohandai/awesome-sub-agents registry shape
 * (schemaVersion 1, slug categories, real description wording).
 */
const registry = {
  schemaVersion: 1,
  repository: 'https://github.com/autohandai/awesome-sub-agents',
  agents: [
    {
      name: 'api-designer',
      description: 'Use when a task needs API contract design, evolution planning, or compatibility review before implementation starts.',
      category: '01-core-development',
      path: 'categories/01-core-development/api-designer.md',
      tools: ['read_file', 'fff_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'backend-developer',
      description: 'Use when a task needs scoped backend implementation or backend bug fixes after the owning path is known.',
      category: '01-core-development',
      path: 'categories/01-core-development/backend-developer.md',
      tools: ['read_file', 'fff_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
    {
      name: 'ui-designer',
      description: 'Use when a task needs concrete UI decisions, interaction design, and implementation-ready design guidance before or during development.',
      category: '01-core-development',
      path: 'categories/01-core-development/ui-designer.md',
      tools: ['read_file', 'fff_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'react-specialist',
      description: 'Use when a task needs modern React implementation patterns, component architecture, or React-specific debugging.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/react-specialist.md',
      tools: ['read_file', 'fff_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
    {
      name: 'expo-react-native-expert',
      description: 'Use when a task needs Expo and React Native mobile development.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/expo-react-native-expert.md',
      tools: ['read_file', 'fff_grep', 'fff_find', 'apply_patch'],
      model: 'gpt-5.4',
    },
    {
      name: 'security-auditor',
      description: 'Use when a task needs security vulnerability review and hardening guidance.',
      category: '04-quality-security',
      path: 'categories/04-quality-security/security-auditor.md',
      tools: ['read_file', 'fff_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'ai-writing-auditor',
      description: 'Use when a task needs AI writing pattern audit and rewrite guidance.',
      category: '04-quality-security',
      path: 'categories/04-quality-security/ai-writing-auditor.md',
      tools: ['read_file', 'fff_grep'],
      model: 'gpt-5.3-codex-spark',
    },
    {
      name: 'node-specialist',
      description: 'Use when a task needs Node.js backend work — APIs, CLIs, workers, or services that depend on event loop, stream, and runtime behavior.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/node-specialist.md',
      tools: ['read_file', 'fff_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
  ],
};

const uiDesignerMarkdown = [
  '---',
  'description: Use when a task needs concrete UI decisions, interaction design, and implementation-ready design guidance before or during development.',
  'tools: read_file, fff_grep, fff_find',
  'model: gpt-5.4',
  '---',
  '',
  'Produce implementation-ready UI guidance with explicit interaction and accessibility intent.',
  '',
].join('\n');

function mockFetch(markdown = uiDesignerMarkdown): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.endsWith('/registry.json')) {
      return new Response(JSON.stringify(registry), { status: 200 });
    }
    if (href.endsWith('/categories/01-core-development/ui-designer.md')) {
      return new Response(markdown, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('sub-agent catalog tools', () => {
  it('exposes search and approval-gated install definitions', () => {
    const search = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'find_sub_agents');
    const install = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'install_sub_agent');

    expect(search?.parameters?.required).toContain('query');
    expect(search?.parameters?.properties).toHaveProperty('category');
    expect(install?.parameters?.required).toContain('name');
    expect(install?.requiresApproval).toBe(true);
  });

  it('keeps catalog search available after relevance filtering', () => {
    const messages: LLMMessage[] = [{ role: 'user', content: 'bring in a UI specialist' }];
    const tool = DEFAULT_TOOL_DEFINITIONS.find((definition) => definition.name === 'find_sub_agents')!;

    const filtered = filterToolsByRelevance([tool], messages);

    expect(filtered.map((definition) => definition.name)).toContain('find_sub_agents');
  });

  it('advertises catalog installation after search returns exact install guidance', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'bring in a UI specialist' },
      {
        role: 'tool',
        name: 'find_sub_agents',
        content: 'install: install_sub_agent name="ui-designer"',
      },
    ];
    const tool = DEFAULT_TOOL_DEFINITIONS.find((definition) => definition.name === 'install_sub_agent')!;

    const filtered = filterToolsByRelevance([tool], messages);

    expect(filtered.map((definition) => definition.name)).toContain('install_sub_agent');
  });
});

describe('sub-agent catalog actions', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('searches registry entries and returns exact install guidance', async () => {
    const result = await searchSubAgentsCatalog('UI design specialist', {
      fetchImpl: mockFetch(),
      limit: 5,
    });

    expect(result).toContain('ui-designer');
    expect(result).toContain('install: install_sub_agent name="ui-designer"');
    expect(result).toContain('name: ui-designer');
  });

  it('ranks and renders live-shaped registry agents for realistic LLM queries', async () => {
    const ui = await searchSubAgentsCatalog('accessible UI specialist', {
      fetchImpl: mockFetch(),
      limit: 5,
    });
    expect(ui).toContain('Found ');
    expect(ui).toContain('ui-designer');
    expect(ui).toContain('install_sub_agent name="ui-designer"');
    // Ranked: ui-designer should appear before unrelated security agents.
    expect(ui.indexOf('ui-designer')).toBeLessThan(ui.indexOf('security-auditor') === -1
      ? Number.POSITIVE_INFINITY
      : ui.indexOf('security-auditor'));

    const react = await searchSubAgentsCatalog('react specialist', {
      fetchImpl: mockFetch(),
      limit: 3,
    });
    expect(react.indexOf('react-specialist')).toBeLessThan(react.indexOf('expo-react-native-expert'));

    const security = await searchSubAgentsCatalog('security auditor', {
      fetchImpl: mockFetch(),
      limit: 3,
    });
    expect(security.indexOf('security-auditor')).toBeLessThan(security.indexOf('ai-writing-auditor'));

    const backend = await searchSubAgentsCatalog('backend api', {
      fetchImpl: mockFetch(),
      limit: 5,
    });
    expect(backend).toContain('backend-developer');
    expect(backend).toContain('node-specialist');
  });

  it('supports partial category filters used by LLMs', async () => {
    const result = await searchSubAgentsCatalog('ui', {
      fetchImpl: mockFetch(),
      category: 'core-development',
      limit: 10,
    });

    expect(result).toContain('ui-designer');
    expect(result).not.toContain('react-specialist');
  });

  it('renders catalog results in a stable machine-readable layout for install handoff', async () => {
    const result = await searchSubAgentsCatalog('ui-designer', {
      fetchImpl: mockFetch(),
      limit: 1,
    });

    expect(result).toMatch(/Found \d+ sub-agent/);
    expect(result).toContain('name: ui-designer');
    expect(result).toContain('category: 01-core-development');
    expect(result).toContain('description:');
    expect(result).toContain('tools:');
    expect(result).toContain('install: install_sub_agent name="ui-designer"');
  });

  it('discovers and ranks agents from the live awesome-sub-agents registry', async () => {
    const result = await searchSubAgentsCatalog('backend api', { limit: 8 });
    expect(result).toMatch(/Found \d+ sub-agent/);
    expect(result).toContain('install: install_sub_agent name=');
    // Live catalog should surface backend-oriented specialists for this query.
    expect(
      result.includes('backend-developer')
      || result.includes('node-specialist')
      || result.includes('api-designer'),
    ).toBe(true);

    const ui = await searchSubAgentsCatalog('UI design', { limit: 8 });
    expect(ui).toContain('ui-designer');
    expect(ui).toContain('name: ui-designer');
    expect(ui).toContain('install: install_sub_agent name="ui-designer"');
  }, 30_000);

  it('installs an exact catalog agent as Autohand markdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);

    const result = await installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(),
    });

    const installed = await fs.readFile(path.join(root, 'ui-designer.md'), 'utf8');
    expect(installed).toBe(uiDesignerMarkdown);
    expect(result).toContain('Installed sub-agent ui-designer');
    expect(result).toContain('delegate_task');
    expect(result).toContain('add_teammate');
  });

  it('does not overwrite an existing definition unless explicitly requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const targetPath = path.join(root, 'ui-designer.md');
    await fs.writeFile(targetPath, 'existing definition', 'utf8');

    const result = await installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(),
    });

    expect(result).toContain('already exists');
    expect(await fs.readFile(targetPath, 'utf8')).toBe('existing definition');
  });

  it('rejects invalid downloaded definitions before writing a file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);

    await expect(installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch('# Missing frontmatter'),
    })).rejects.toThrow('did not download as an Autohand markdown agent');

    await expect(fs.access(path.join(root, 'ui-designer.md'))).rejects.toThrow();
  });
});
