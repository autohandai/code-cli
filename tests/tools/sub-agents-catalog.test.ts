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

const registry = {
  schemaVersion: 1,
  repository: 'https://github.com/autohandai/awesome-sub-agents',
  agents: [
    {
      name: 'ui-designer',
      description: 'Designs accessible production user interfaces',
      category: '03-design-experience',
      path: 'categories/03-design-experience/ui-designer.md',
      tools: ['read_file', 'apply_patch'],
      model: 'gpt-5.4',
    },
    {
      name: 'security-reviewer',
      description: 'Reviews code for security risks and unsafe defaults',
      category: '04-quality-security',
      path: 'categories/04-quality-security/security-reviewer.md',
      tools: ['read_file', 'fff_grep'],
    },
  ],
};

const uiDesignerMarkdown = [
  '---',
  'description: Designs accessible production user interfaces',
  'tools: read_file, apply_patch',
  'model: gpt-5.4',
  '---',
  '',
  'Own UI implementation and accessibility validation.',
  '',
].join('\n');

function mockFetch(markdown = uiDesignerMarkdown): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.endsWith('/registry.json')) {
      return new Response(JSON.stringify(registry), { status: 200 });
    }
    if (href.endsWith('/categories/03-design-experience/ui-designer.md')) {
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
        content: 'Install: install_sub_agent name="ui-designer"',
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
    const result = await searchSubAgentsCatalog('accessible UI', {
      fetchImpl: mockFetch(),
      limit: 5,
    });

    expect(result).toContain('ui-designer');
    expect(result).toContain('Designs accessible production user interfaces');
    expect(result).toContain('install_sub_agent name="ui-designer"');
    expect(result).not.toContain('security-reviewer');
  });

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
