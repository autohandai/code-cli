/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import { filterToolsByRelevance } from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';
import { AgentRegistry } from '../../src/core/agents/AgentRegistry.js';
import {
  installSubAgentFromCatalog,
  fetchSubAgentsRegistry,
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
      tools: ['read_file', 'find_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'backend-developer',
      description: 'Use when a task needs scoped backend implementation or backend bug fixes after the owning path is known.',
      category: '01-core-development',
      path: 'categories/01-core-development/backend-developer.md',
      tools: ['read_file', 'find_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
    {
      name: 'ui-designer',
      description: 'Use when a task needs concrete UI decisions, interaction design, and implementation-ready design guidance before or during development.',
      category: '01-core-development',
      path: 'categories/01-core-development/ui-designer.md',
      tools: ['read_file', 'find_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'react-specialist',
      description: 'Use when a task needs modern React implementation patterns, component architecture, or React-specific debugging.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/react-specialist.md',
      tools: ['read_file', 'find_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
    {
      name: 'expo-react-native-expert',
      description: 'Use when a task needs Expo and React Native mobile development.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/expo-react-native-expert.md',
      tools: ['read_file', 'find_grep', 'fff_find', 'apply_patch'],
      model: 'gpt-5.4',
    },
    {
      name: 'security-auditor',
      description: 'Use when a task needs security vulnerability review and hardening guidance.',
      category: '04-quality-security',
      path: 'categories/04-quality-security/security-auditor.md',
      tools: ['read_file', 'find_grep', 'fff_find'],
      model: 'gpt-5.4',
    },
    {
      name: 'ai-writing-auditor',
      description: 'Use when a task needs AI writing pattern audit and rewrite guidance.',
      category: '04-quality-security',
      path: 'categories/04-quality-security/ai-writing-auditor.md',
      tools: ['read_file', 'find_grep'],
      model: 'gpt-5.3-codex-spark',
    },
    {
      name: 'node-specialist',
      description: 'Use when a task needs Node.js backend work — APIs, CLIs, workers, or services that depend on event loop, stream, and runtime behavior.',
      category: '02-language-specialists',
      path: 'categories/02-language-specialists/node-specialist.md',
      tools: ['read_file', 'find_grep', 'fff_find', 'apply_patch', 'search_replace', 'run_command'],
      model: 'gpt-5.4',
    },
  ],
};

const uiDesignerMarkdown = [
  '---',
  'description: Use when a task needs concrete UI decisions, interaction design, and implementation-ready design guidance before or during development.',
  'tools: read_file, find_grep, fff_find',
  'model: gpt-5.4',
  '---',
  '',
  'Produce implementation-ready UI guidance with explicit interaction and accessibility intent.',
  '',
].join('\n');

function mockFetch(markdown = uiDesignerMarkdown, registryPayload = registry): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.endsWith('/registry.json')) {
      return new Response(JSON.stringify(registryPayload), { status: 200 });
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
    vi.useRealTimers();
    (AgentRegistry as unknown as { instance?: AgentRegistry }).instance = undefined;
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('bounds a catalogue fetch even when a transport ignores its abort signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const pending = fetchSubAgentsRegistry({ fetchImpl });
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });

  it('rejects oversized catalogue headers and streamed bodies before parsing metadata', async () => {
    await expect(fetchSubAgentsRegistry({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(registry), {
        headers: { 'content-length': String(3 * 1024 * 1024) },
      })),
    })).rejects.toThrow('response exceeds 2097152 bytes');

    await expect(fetchSubAgentsRegistry({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1))),
    })).rejects.toThrow('response exceeds 2097152 bytes');
  });

  it('cancels a stalled response body at the same request deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const pending = fetchSubAgentsRegistry({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(body)),
    });
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['ui-designer', 'UI-Designer'])('rejects ambiguous duplicate catalog names (%s)', async (name) => {
    const duplicateRegistry = {
      ...registry,
      agents: [registry.agents[2], { ...registry.agents[2], name }],
    };

    await expect(fetchSubAgentsRegistry({
      fetchImpl: mockFetch(uiDesignerMarkdown, duplicateRegistry),
    })).rejects.toThrow('duplicate catalog agent name');
  });

  it('revalidates a supplied registry before fetching installation content', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const fetchImpl = vi.fn<typeof fetch>(mockFetch());

    await expect(installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      registry: { ...registry, agents: [{ ...registry.agents[2], path: '../ui-designer.md' }] },
      fetchImpl,
    })).rejects.toThrow('invalid catalog path');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('uses labelled validated metadata during an outage without installing agent prompts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      ...registry,
      agents: registry.agents.map((agent) => ({ ...agent, prompt: 'Do not cache this executable prompt.' })),
    })));

    await searchSubAgentsCatalog('UI design', { fetchImpl: network, cachePath });
    const result = await searchSubAgentsCatalog('UI design', {
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      cachePath,
    });

    expect(result).toContain('Using validated cached catalogue metadata');
    expect(result).toContain('name: ui-designer');
    expect(result).toContain('install: install_sub_agent name="ui-designer"');
    expect(await fs.readFile(cachePath, 'utf8')).not.toContain('executable prompt');
    expect(await fs.readdir(root)).toEqual(['registry.json']);
  });

  it.each([
    { tools: ['read_file', 42] },
    { tools: ['read_file', 'run command'] },
    { tools: ['read_file', ''] },
    { sha256: 42 },
  ])('rejects malformed tool and hash metadata without silently dropping it (%j)', async (invalid) => {
    await expect(fetchSubAgentsRegistry({
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        ...registry,
        agents: [{ ...registry.agents[2], ...invalid }],
      }))),
    })).rejects.toThrow(/invalid .*registry entry/);
  });

  it.each([503, 429, 'broken-body'] as const)('uses cached metadata for a transient fetch failure (%s)', async (failure) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    await fetchSubAgentsRegistry({ fetchImpl: mockFetch(), cachePath });
    const response = typeof failure === 'number'
      ? new Response('unavailable', { status: failure })
      : new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new TypeError('connection interrupted')); },
      }));

    const result = await searchSubAgentsCatalog('UI design', {
      fetchImpl: vi.fn<typeof fetch>(async () => response),
      cachePath,
    });

    expect(result).toContain('Using validated cached catalogue metadata');
    expect(result).toContain('name: ui-designer');
  });

  it.each([
    { reason: 'expired', patch: { fetchedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 } },
    { reason: 'future timestamp', patch: { fetchedAt: Date.now() + 24 * 60 * 60 * 1000 } },
    { reason: 'different source', patch: { registryUrl: 'https://example.test/registry.json' } },
    { reason: 'unsupported schema', patch: { registry: { ...registry, schemaVersion: 2 } } },
    { reason: 'duplicate name', patch: { registry: { ...registry, agents: [registry.agents[2], registry.agents[2]] } } },
    { reason: 'unsafe path', patch: { registry: { ...registry, agents: [{ ...registry.agents[2], path: '../agent.md' }] } } },
    { reason: 'invalid tools', patch: { registry: { ...registry, agents: [{ ...registry.agents[2], tools: ['read_file', 42] }] } } },
    { reason: 'invalid hash', patch: { registry: { ...registry, agents: [{ ...registry.agents[2], sha256: 42 }] } } },
  ])('refuses cached metadata with $reason', async ({ patch }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    await fetchSubAgentsRegistry({ fetchImpl: mockFetch(), cachePath });
    const cached: Record<string, unknown> = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    await fs.writeFile(cachePath, JSON.stringify({ ...cached, ...patch }));

    await expect(searchSubAgentsCatalog('UI design', {
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      cachePath,
    })).rejects.toThrow('catalogue request failed');
  });

  it.each(['malformed-json', 'oversized', 'missing'] as const)('ignores unusable cached metadata (%s)', async (failure) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    if (failure !== 'missing') {
      await fs.writeFile(cachePath, failure === 'oversized' ? ' '.repeat(2 * 1024 * 1024 + 1) : '{');
    }

    await expect(searchSubAgentsCatalog('UI design', {
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      cachePath,
    })).rejects.toThrow('catalogue request failed');
  });

  it.each(['invalid-metadata', 'oversized', 'not-found'] as const)('does not hide invalid live responses with cached metadata (%s)', async (failure) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    await fetchSubAgentsRegistry({ fetchImpl: mockFetch(), cachePath });
    const previous = await fs.readFile(cachePath, 'utf8');
    const response = failure === 'not-found' ? new Response('not found', { status: 404 })
      : new Response(failure === 'oversized' ? ' '.repeat(2 * 1024 * 1024 + 1) : 'null');

    await expect(searchSubAgentsCatalog('UI design', {
      fetchImpl: vi.fn<typeof fetch>(async () => response),
      cachePath,
    })).rejects.toThrow();
    expect(await fs.readFile(cachePath, 'utf8')).toBe(previous);
  });

  it('keeps live discovery available when the metadata cache cannot be written', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const parentFile = path.join(root, 'not-a-directory');
    await fs.writeFile(parentFile, 'preserve this file');

    const result = await searchSubAgentsCatalog('UI design', {
      fetchImpl: mockFetch(),
      cachePath: path.join(parentFile, 'registry.json'),
    });

    expect(result).toContain('name: ui-designer');
    expect(await fs.readFile(parentFile, 'utf8')).toBe('preserve this file');
  });

  it('requires fresh downloadable content even after using cached metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const cachePath = path.join(root, 'registry.json');
    await fetchSubAgentsRegistry({ fetchImpl: mockFetch(), cachePath });
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const cachedRegistry = await fetchSubAgentsRegistry({ fetchImpl: offline, cachePath });

    await expect(installSubAgentFromCatalog('ui-designer', {
      registry: cachedRegistry,
      destinationDir: root,
      fetchImpl: offline,
    })).rejects.toThrow('catalogue request failed');
    expect(await fs.readdir(root)).toEqual(['registry.json']);
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
    const result = await searchSubAgentsCatalog('backend api', { limit: 8, cachePath: false });
    expect(result).toMatch(/Found \d+ sub-agent/);
    expect(result).toContain('install: install_sub_agent name=');
    // Live catalog should surface backend-oriented specialists for this query.
    expect(
      result.includes('backend-developer')
      || result.includes('node-specialist')
      || result.includes('api-designer'),
    ).toBe(true);

    const ui = await searchSubAgentsCatalog('UI design', { limit: 8, cachePath: false });
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

  it('does not install a differently named agent through its catalog filename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const renamedRegistry = {
      ...registry,
      agents: [{ ...registry.agents[2], name: 'canonical-ui-designer' }],
    };

    const result = await installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(uiDesignerMarkdown, renamedRegistry),
    });

    expect(result).toContain('Sub-agent not found: "ui-designer".');
    expect(result).toContain('Similar sub-agents: canonical-ui-designer');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('installs a case-insensitive exact registry name when its filename differs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const renamedRegistry = {
      ...registry,
      agents: [{ ...registry.agents[2], name: 'canonical-ui-designer' }],
    };

    const result = await installSubAgentFromCatalog(' CANONICAL-UI-DESIGNER ', {
      destinationDir: root,
      fetchImpl: mockFetch(uiDesignerMarkdown, renamedRegistry),
    });

    expect(result).toContain('Installed sub-agent canonical-ui-designer');
    expect(await fs.readFile(path.join(root, 'canonical-ui-designer.md'), 'utf8'))
      .toBe(uiDesignerMarkdown);
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

  it('rejects catalog paths that escape the trusted raw-content root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const unsafeRegistry = {
      ...registry,
      agents: [{ ...registry.agents[2], path: '../ui-designer.md' }],
    };

    await expect(installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(uiDesignerMarkdown, unsafeRegistry),
    })).rejects.toThrow('invalid catalog path');

    expect(await fs.readdir(root)).toEqual([]);
  });

  it('rejects content that does not match a registry-provided sha256', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);
    const hashedRegistry = {
      ...registry,
      agents: [{ ...registry.agents[2], sha256: '0'.repeat(64) }],
    };

    await expect(installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(uiDesignerMarkdown, hashedRegistry),
    })).rejects.toThrow('content hash mismatch');

    expect(await fs.readdir(root)).toEqual([]);
  });

  it('validates downloaded tool allowlists before installation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);

    await expect(installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(uiDesignerMarkdown.replace('fff_find', 'unknown_catalog_tool')),
      allowedTools: new Set(['read_file', 'find_grep', 'fff_find']),
    })).rejects.toThrow('unsupported tool');

    expect(await fs.readdir(root)).toEqual([]);
  });

  it('persists catalog provenance and reclassifies a tampered definition as user-owned', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-sub-agents-'));
    tempRoots.push(root);

    await installSubAgentFromCatalog('ui-designer', {
      destinationDir: root,
      fetchImpl: mockFetch(),
    });

    const provenancePath = path.join(root, '.catalog', 'provenance.json');
    const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
      entries: Record<string, { contentHash: string; catalogPath: string }>;
    };
    expect(provenance.entries['ui-designer']).toEqual(expect.objectContaining({
      contentHash: createHash('sha256').update(uiDesignerMarkdown).digest('hex'),
      catalogPath: 'categories/01-core-development/ui-designer.md',
    }));

    const registryInstance = AgentRegistry.getInstance();
    (registryInstance as unknown as { agentsDir: string }).agentsDir = root;
    await registryInstance.loadAgents();
    expect(registryInstance.getAgent('ui-designer')?.source).toBe('catalog');

    await fs.writeFile(path.join(root, 'ui-designer.md'), `${uiDesignerMarkdown}\nUser customization.\n`, 'utf8');
    await registryInstance.loadAgents();
    expect(registryInstance.getAgent('ui-designer')?.source).toBe('user');
  });
});
