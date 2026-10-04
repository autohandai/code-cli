/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinition, AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import type { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import type { CatalogRegistry } from '../../../src/actions/subAgentsCatalog.js';
import {
  detectSpecialistRequest,
  createSpecialistRequest,
  SpecialistOrchestrator,
  type SpecialistPlan,
} from '../../../src/core/agents/SpecialistOrchestrator.js';

function agent(
  name: string,
  source: AgentDefinition['source'],
  description = `${name} specialist`,
): AgentDefinition {
  return {
    name,
    source,
    description,
    systemPrompt: `Act as ${name}.`,
    tools: ['read_file'],
    path: `/agents/${name}.md`,
  };
}

function registryWith(definitions: AgentDefinition[]): AgentRegistry {
  return {
    loadAgents: vi.fn().mockResolvedValue(undefined),
    getAllAgents: vi.fn().mockReturnValue(definitions),
  } as unknown as AgentRegistry;
}

function delegator() {
  return {
    delegateParallelForTool: vi.fn().mockResolvedValue({ success: true, output: 'parallel results' }),
    delegateTaskForTool: vi.fn().mockResolvedValue({ success: true, output: 'serial result' }),
  } as unknown as AgentDelegator;
}

const catalogRegistry: CatalogRegistry = {
  schemaVersion: 1,
  repository: 'https://github.com/autohandai/awesome-sub-agents',
  agents: [
    {
      name: 'ui-designer',
      description: 'User interface design specialist',
      category: 'design',
      path: 'categories/design/ui-designer.md',
      tools: ['read_file'],
    },
    {
      name: 'ux-researcher',
      description: 'User experience research specialist',
      category: 'design',
      path: 'categories/design/ux-researcher.md',
      tools: ['read_file'],
    },
  ],
};

describe('specialist intent detection', () => {
  it('extracts stable roles from the explicit MOA-style prompt', () => {
    expect(detectSpecialistRequest('Bring a team of ui, ux, security to inspect this repo.')).toEqual({
      objective: 'Bring a team of ui, ux, security to inspect this repo.',
      requestedRoles: ['ui', 'ux', 'security'],
      source: 'intent',
      executionMode: 'parallel',
    });
  });

  it('preserves the order in which the user requested roles', () => {
    expect(detectSpecialistRequest('Bring security, ui, and ux agents to inspect this repo.')?.requestedRoles)
      .toEqual(['security', 'ui', 'ux']);
  });

  it('does not infer orchestration from incidental agent terminology', () => {
    expect(detectSpecialistRequest('Explain how the agent registry works.')).toBeNull();
    expect(detectSpecialistRequest('Review the security module.')).toBeNull();
  });

  it('ignores context a host application wrapped around the user message', () => {
    // Desktop clients put their own context in front of what the user typed. That
    // text is full of ordinary words ("use", "agent", "review", "test") and must
    // never be read as the user asking for specialists.
    const hostContext = [
      '<autohand_response_modes>',
      'Use short sentences. The agent keeps a glossary. Review every answer and run the tests.',
      '</autohand_response_modes>',
      '',
      '<autohand_user_profile>',
      'I lead the security team and need docs for every release.',
      '</autohand_user_profile>',
    ].join('\n');

    expect(detectSpecialistRequest(`${hostContext}\n\nhi`)).toBeNull();
    expect(detectSpecialistRequest(`${hostContext}\n\nwhat are the last 2 changes made here`)).toBeNull();
    expect(detectSpecialistRequest([
      '<thread_context>',
      'Earlier the user asked to bring a team of ui and security agents.',
      '</thread_context>',
      '',
      '<latest_user_message>',
      'what changed since then?',
      '</latest_user_message>',
    ].join('\n'))).toBeNull();
  });

  it('still detects a request the user typed after host context, without the context in the objective', () => {
    const request = detectSpecialistRequest([
      '<autohand_response_modes>',
      'Use short sentences. The agent keeps a glossary. Review every answer and run the tests.',
      '</autohand_response_modes>',
      '',
      'Bring a team of ui and security agents to inspect this repo.',
    ].join('\n'));

    expect(request).toEqual({
      objective: 'Bring a team of ui and security agents to inspect this repo.',
      requestedRoles: ['ui', 'security'],
      source: 'intent',
      executionMode: 'parallel',
    });
    expect(detectSpecialistRequest([
      '<thread_context>',
      'Earlier work touched the docs and the tests.',
      '</thread_context>',
      '',
      '<latest_user_message>',
      'Bring a security agent to inspect this repo.',
      '</latest_user_message>',
    ].join('\n'))).toMatchObject({
      objective: 'Bring a security agent to inspect this repo.',
      requestedRoles: ['security'],
    });
  });

  it('serializes objectives that explicitly request workspace mutation', () => {
    expect(detectSpecialistRequest('Bring UI and security agents to implement this change.')?.executionMode)
      .toBe('serial');
  });
});

describe('SpecialistOrchestrator resolution', () => {
  it('prefers Autohand Review for the built-in review role', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([
        agent('reviewer', 'builtin'),
        agent('autohand-review', 'builtin'),
      ]),
      offline: true,
    });
    const request = detectSpecialistRequest('Bring a review agent to inspect this repo.')!;

    const plan = await orchestrator.resolve(request);

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({
        requestedRole: 'review',
        agentName: 'autohand-review',
        source: 'builtin',
      }),
    ]);
  });

  it('resolves an exact installed custom role without requiring a built-in taxonomy entry', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('domain-owner', 'session')]),
      offline: true,
    });
    const plan = await orchestrator.resolve(createSpecialistRequest('Inspect the domain contract', ['domain-owner']));

    expect(plan.unresolvedRoles).toEqual([]);
    expect(plan.selectedAgents).toEqual([expect.objectContaining({
      requestedRole: 'domain-owner', agentName: 'domain-owner', source: 'session',
    })]);
  });

  it('resolves the delivery lifecycle and cleanup aliases consistently without a catalogue request', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([
        agent('requirements-translator', 'builtin'),
        agent('software-architect', 'builtin'),
        agent('implementer', 'builtin'),
        agent('code-cleaner', 'builtin'),
        agent('docs-writer', 'builtin'),
        agent('todo-resolver', 'builtin'),
      ]),
      offline: true,
    });
    const plan = await orchestrator.resolve(createSpecialistRequest('Assess delivery readiness', [
      'requirements', 'software architect', 'implementer', 'deslop', 'docs', 'todo',
    ]));

    expect(plan.unresolvedRoles).toEqual([]);
    expect(plan.selectedAgents.map((selected) => selected.agentName)).toEqual([
      'requirements-translator', 'software-architect', 'implementer', 'code-cleaner', 'docs-writer', 'todo-resolver',
    ]);
  });

  it('uses source precedence before role score and avoids duplicate agents', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([
        agent('session-design-lead', 'session', 'UI and UX design specialist'),
        agent('ui-designer', 'builtin'),
        agent('ux-researcher', 'extension'),
      ]),
      offline: true,
    });
    const request = detectSpecialistRequest('Bring UI and UX agents to inspect this repo.')!;

    const plan = await orchestrator.resolve(request);

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'ui', agentName: 'session-design-lead', source: 'session' }),
      expect.objectContaining({ requestedRole: 'ux', agentName: 'ux-researcher', source: 'extension' }),
    ]);
  });

  it('resolves missing local roles from one catalog snapshot while preserving requested-role order', async () => {
    const fetchRegistry = vi.fn().mockResolvedValue(catalogRegistry);
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('security-auditor', 'builtin')]),
      catalog: { fetchRegistry, install: vi.fn() },
    });
    const request = detectSpecialistRequest('Bring a team of ui, ux, security to inspect this repo.')!;

    const plan = await orchestrator.resolve(request);

    expect(fetchRegistry).toHaveBeenCalledTimes(1);
    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'ui', agentName: 'ui-designer', source: 'catalog' }),
      expect.objectContaining({ requestedRole: 'ux', agentName: 'ux-researcher', source: 'catalog' }),
      expect.objectContaining({ requestedRole: 'security', agentName: 'security-auditor', source: 'builtin' }),
    ]);
    expect(plan.unresolvedRoles).toEqual([]);
  });

  it('does not touch the catalog offline and reports unresolved roles once', async () => {
    const fetchRegistry = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('security-auditor', 'builtin')]),
      catalog: { fetchRegistry, install: vi.fn() },
      offline: true,
    });
    const request = detectSpecialistRequest('Bring a team of ui and security agents to inspect this repo.')!;

    const plan = await orchestrator.resolve(request);

    expect(fetchRegistry).not.toHaveBeenCalled();
    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'security', agentName: 'security-auditor' }),
    ]);
    expect(plan.unresolvedRoles).toEqual(['ui']);
  });

  it('continues with local specialists when catalog lookup fails', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('security-auditor', 'builtin')]),
      catalog: {
        fetchRegistry: vi.fn().mockRejectedValue(new Error('catalog offline')),
        install: vi.fn(),
      },
    });
    const request = detectSpecialistRequest('Bring a team of ui and security agents to inspect this repo.')!;

    const plan = await orchestrator.resolve(request);

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'security', agentName: 'security-auditor' }),
    ]);
    expect(plan.unresolvedRoles).toEqual(['ui']);
    expect(plan.resolutionNotice).toContain('catalog offline');
  });

  it('installs all catalog selections from the resolved snapshot and reloads definitions once', async () => {
    const registry = registryWith([agent('security-auditor', 'builtin')]);
    const install = vi.fn().mockImplementation(async (name: string) => `Installed sub-agent ${name}.`);
    const allowedTools = new Set(['read_file']);
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry,
      catalog: { fetchRegistry: vi.fn().mockResolvedValue(catalogRegistry), install },
      getAllowedTools: () => allowedTools,
    });
    const request = detectSpecialistRequest('Bring a team of ui, ux, security to inspect this repo.')!;
    const plan = await orchestrator.resolve(request);

    const result = await orchestrator.installCatalogSelections(plan);

    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenNthCalledWith(1, 'ui-designer', {
      registry: catalogRegistry,
      allowedTools,
    });
    expect(install).toHaveBeenNthCalledWith(2, 'ux-researcher', {
      registry: catalogRegistry,
      allowedTools,
    });
    expect(result).toEqual({ installedAgents: ['ui-designer', 'ux-researcher'], failedAgents: [] });
    expect(registry.loadAgents).toHaveBeenCalledTimes(2);
  });

  it('uses specialists already installed from the catalog without installing them again', async () => {
    // The registry reports catalog-managed files under ~/.autohand/agents with the
    // "catalog" source. They are installed: nothing is staged and nothing is fetched.
    const fetchRegistry = vi.fn().mockResolvedValue(catalogRegistry);
    const install = vi.fn().mockResolvedValue('Sub-agent reviewer already exists at /agents/reviewer.md. Use overwrite=true to replace it.');
    const delegate = delegator();
    const orchestrator = new SpecialistOrchestrator(delegate, {
      registry: registryWith([
        agent('reviewer', 'catalog'),
        agent('ui-ux-tester', 'catalog', 'UI and UX tester for release checks'),
      ]),
      catalog: { fetchRegistry, install },
    });
    const plan = await orchestrator.resolve(createSpecialistRequest('Inspect this repo.', ['testing', 'review']));

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'testing', agentName: 'ui-ux-tester', source: 'catalog' }),
      expect.objectContaining({ requestedRole: 'review', agentName: 'reviewer', source: 'catalog' }),
    ]);
    expect(orchestrator.stageCatalogInstallation(plan)).toBeUndefined();
    expect(await orchestrator.installCatalogSelections(plan)).toEqual({ installedAgents: [], failedAgents: [] });
    expect(fetchRegistry).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();

    const result = await orchestrator.execute(plan);
    expect(result.completed).toBe(true);
    expect(plan.unresolvedRoles).toEqual([]);
    expect(delegate.delegateParallelForTool).toHaveBeenCalledWith(
      [
        expect.objectContaining({ agent_name: 'ui-ux-tester' }),
        expect.objectContaining({ agent_name: 'reviewer' }),
      ],
      {},
    );
  });

  it('stages only the specialists that still have to come from the catalog', async () => {
    const install = vi.fn().mockImplementation(async (name: string) => `Installed sub-agent ${name}.`);
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('reviewer', 'catalog')]),
      catalog: { fetchRegistry: vi.fn().mockResolvedValue(catalogRegistry), install },
    });
    const plan = await orchestrator.resolve(createSpecialistRequest('Inspect this repo.', ['review', 'ui']));

    const staged = orchestrator.stageCatalogInstallation(plan);
    expect(staged?.agentNames).toEqual(['ui-designer']);

    const result = await orchestrator.installStagedCatalogSelections(staged!.planId, staged!.agentNames);
    expect(result).toEqual({ installedAgents: ['ui-designer'], failedAgents: [] });
    expect(install).toHaveBeenCalledTimes(1);
    // Once installed there is nothing left to stage for the same plan.
    expect(orchestrator.stageCatalogInstallation(plan)).toBeUndefined();
  });

  it('keeps installed catalog specialists when a staged installation is declined', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('reviewer', 'catalog')]),
      catalog: { fetchRegistry: vi.fn().mockResolvedValue(catalogRegistry), install: vi.fn() },
    });
    const plan = await orchestrator.resolve(createSpecialistRequest('Inspect this repo.', ['review', 'ui']));
    const staged = orchestrator.stageCatalogInstallation(plan)!;

    orchestrator.declineStagedCatalogInstallation(staged.planId);

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'review', agentName: 'reviewer' }),
    ]);
    expect(plan.unresolvedRoles).toEqual(['ui']);
    expect(plan.resolutionNotice).toContain('ui-designer');
    expect(plan.resolutionNotice).not.toContain('reviewer');
  });

  it('keeps valid local specialists and reports each denied catalog selection once', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('security-auditor', 'builtin')]),
      catalog: {
        fetchRegistry: vi.fn().mockResolvedValue(catalogRegistry),
        install: vi.fn().mockResolvedValue('Sub-agent ui-designer already exists.'),
      },
    });
    const request = detectSpecialistRequest('Bring a team of ui and security agents to inspect this repo.')!;
    const plan = await orchestrator.resolve(request);

    const result = await orchestrator.installCatalogSelections(plan);

    expect(result.failedAgents).toEqual(['ui-designer']);
    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ requestedRole: 'security', agentName: 'security-auditor' }),
    ]);
    expect(plan.unresolvedRoles).toEqual(['ui']);
    expect(plan.resolutionNotice).toContain('ui-designer');
  });

  it('consumes a denied staged roster once and keeps valid local specialists executable', async () => {
    const orchestrator = new SpecialistOrchestrator(delegator(), {
      registry: registryWith([agent('security-auditor', 'builtin')]),
      catalog: {
        fetchRegistry: vi.fn().mockResolvedValue(catalogRegistry),
        install: vi.fn(),
      },
    });
    const plan = await orchestrator.resolve(
      detectSpecialistRequest('Bring a team of ui and security agents to inspect this repo.')!,
    );
    const staged = orchestrator.stageCatalogInstallation(plan)!;

    orchestrator.declineStagedCatalogInstallation(staged.planId);
    orchestrator.declineStagedCatalogInstallation(staged.planId);

    expect(plan.selectedAgents).toEqual([
      expect.objectContaining({ agentName: 'security-auditor' }),
    ]);
    expect(plan.unresolvedRoles).toEqual(['ui']);
    expect(plan.resolutionNotice?.match(/not approved/g)).toHaveLength(1);
  });
});

describe('SpecialistOrchestrator turn results', () => {
  const orchestrator = () => new SpecialistOrchestrator(delegator(), { registry: registryWith([]), offline: true });

  it('hands back the results of a roster that already ran for the turn', () => {
    const specialists = orchestrator();
    specialists.beginTurn();
    specialists.rememberTurnResult(['review', 'testing'], 'results');

    // The lead model tends to ask for the same roster again once it reads the request.
    expect(specialists.turnResultFor(['review', 'testing'])).toBe('results');
    expect(specialists.turnResultFor(['testing'])).toBe('results');
  });

  it('does not reuse results for roles that have not run', () => {
    const specialists = orchestrator();
    specialists.beginTurn();
    specialists.rememberTurnResult(['review'], 'results');

    expect(specialists.turnResultFor(['review', 'security'])).toBeUndefined();
    expect(specialists.turnResultFor([])).toBeUndefined();
  });

  it('forgets the results when the next turn or a fresh session begins', () => {
    const specialists = orchestrator();
    specialists.beginTurn();
    specialists.rememberTurnResult(['review'], 'results');
    specialists.beginTurn();
    expect(specialists.turnResultFor(['review'])).toBeUndefined();

    specialists.rememberTurnResult(['review'], 'results');
    specialists.clearSessionContext();
    expect(specialists.turnResultFor(['review'])).toBeUndefined();
  });
});

describe('SpecialistOrchestrator execution', () => {
  it.each(['parallel', 'serial'] as const)('forwards cancellation and stops later %s batches', async executionMode => {
    const delegate = delegator();
    const controller = new AbortController();
    const execute = executionMode === 'parallel' ? delegate.delegateParallelForTool : delegate.delegateTaskForTool;
    vi.mocked(execute).mockImplementation(async () => {
      controller.abort();
      return { success: false, kind: 'aborted', error: 'Cancelled' };
    });
    const orchestrator = new SpecialistOrchestrator(delegate, { registry: registryWith([]), maxParallel: 1, offline: true });
    const plan: SpecialistPlan = {
      objective: 'Review the repository', requestedRoles: ['one', 'two'],
      selectedAgents: ['one', 'two'].map(role => ({ requestedRole: role, agentName: role, source: 'builtin', matchReason: 'fixture' })),
      source: 'intent', matchReason: 'fixture', executionMode, unresolvedRoles: [],
    };
    await expect(orchestrator.execute(plan, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).toHaveBeenCalledOnce();
    expect(vi.mocked(execute).mock.calls[0].at(-1)).toEqual({ signal: controller.signal });
  });

  it('does not start any specialist when the parent was already cancelled', async () => {
    const delegate = delegator();
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new SpecialistOrchestrator(delegate, { registry: registryWith([]), offline: true });
    await expect(orchestrator.execute({
      objective: 'Review', requestedRoles: ['reviewer'],
      selectedAgents: [{ requestedRole: 'reviewer', agentName: 'reviewer', source: 'builtin', matchReason: 'fixture' }],
      source: 'intent', matchReason: 'fixture', executionMode: 'serial', unresolvedRoles: [],
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(delegate.delegateTaskForTool).not.toHaveBeenCalled();
  });

  it('batches excess parallel roles instead of dropping them', async () => {
    const delegate = delegator();
    const orchestrator = new SpecialistOrchestrator(delegate, {
      registry: registryWith([]),
      maxParallel: 2,
      offline: true,
    });
    const plan: SpecialistPlan = {
      objective: 'Inspect the repository.',
      requestedRoles: ['one', 'two', 'three', 'four', 'five'],
      selectedAgents: ['one', 'two', 'three', 'four', 'five'].map((role) => ({
        requestedRole: role,
        agentName: `${role}-agent`,
        source: 'session',
        matchReason: 'test fixture',
      })),
      source: 'intent',
      matchReason: 'test fixture',
      executionMode: 'parallel',
      unresolvedRoles: [],
    };

    await orchestrator.execute(plan);

    expect(delegate.delegateParallelForTool).toHaveBeenCalledTimes(3);
    expect(delegate.delegateParallelForTool).toHaveBeenNthCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ agent_name: 'one-agent' }),
      expect.objectContaining({ agent_name: 'two-agent' }),
    ]), {});
    expect(delegate.delegateParallelForTool).toHaveBeenNthCalledWith(3, [
      expect.objectContaining({ agent_name: 'five-agent' }),
    ], {});
  });

  it('routes later answers through the same interviewer until it reports completion', async () => {
    const delegate = delegator();
    vi.mocked(delegate.delegateTaskForTool)
      .mockResolvedValueOnce({ success: true, output: 'complete: false\nNext questions: Who is the primary user?' })
      .mockResolvedValueOnce({ success: true, output: 'complete: true\nDecisions: Primary user is an engineer.' });
    const orchestrator = new SpecialistOrchestrator(delegate, {
      registry: registryWith([agent('product-interviewer', 'session')]),
      offline: true,
    });
    const request = detectSpecialistRequest('Bring a product interviewer agent to clarify this feature.')!;
    const plan = await orchestrator.resolve(request);

    await orchestrator.execute(plan);
    expect(orchestrator.hasActiveInterview()).toBe(true);

    const controller = new AbortController();
    const continuation = await orchestrator.continueInterview('The primary user is an engineer.', { signal: controller.signal });

    expect(continuation).not.toBeNull();
    expect(continuation?.plan.selectedAgents).toEqual([
      expect.objectContaining({ agentName: 'product-interviewer', source: 'session' }),
    ]);
    expect(delegate.delegateTaskForTool).toHaveBeenLastCalledWith(
      'product-interviewer',
      expect.stringContaining('The primary user is an engineer.'),
      { signal: controller.signal },
    );
    expect(delegate.delegateTaskForTool).toHaveBeenLastCalledWith(
      'product-interviewer',
      expect.stringContaining('Bring a product interviewer agent to clarify this feature.'),
      { signal: controller.signal },
    );
    expect(orchestrator.hasActiveInterview()).toBe(false);
    expect(await orchestrator.continueInterview('An unrelated later answer.')).toBeNull();
  });

  it('clears an incomplete interview explicitly for a fresh session', async () => {
    const delegate = delegator();
    vi.mocked(delegate.delegateTaskForTool).mockResolvedValue({
      success: true,
      output: 'complete: false\nNext questions: What is the rollout constraint?',
    });
    const orchestrator = new SpecialistOrchestrator(delegate, {
      registry: registryWith([agent('product-interviewer', 'builtin')]),
      offline: true,
    });
    const plan = await orchestrator.resolve(
      detectSpecialistRequest('Bring a product interviewer agent to clarify this feature.')!,
    );
    await orchestrator.execute(plan);

    orchestrator.clearSessionContext();

    expect(orchestrator.hasActiveInterview()).toBe(false);
    expect(await orchestrator.continueInterview('The answer belongs to the old session.')).toBeNull();
  });
});
