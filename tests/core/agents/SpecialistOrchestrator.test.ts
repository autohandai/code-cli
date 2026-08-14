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

  it('serializes objectives that explicitly request workspace mutation', () => {
    expect(detectSpecialistRequest('Bring UI and security agents to implement this change.')?.executionMode)
      .toBe('serial');
  });
});

describe('SpecialistOrchestrator resolution', () => {
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

describe('SpecialistOrchestrator execution', () => {
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
    ]));
    expect(delegate.delegateParallelForTool).toHaveBeenNthCalledWith(3, [
      expect.objectContaining({ agent_name: 'five-agent' }),
    ]);
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

    const continuation = await orchestrator.continueInterview('The primary user is an engineer.');

    expect(continuation).not.toBeNull();
    expect(continuation?.plan.selectedAgents).toEqual([
      expect.objectContaining({ agentName: 'product-interviewer', source: 'session' }),
    ]);
    expect(delegate.delegateTaskForTool).toHaveBeenLastCalledWith(
      'product-interviewer',
      expect.stringContaining('The primary user is an engineer.'),
    );
    expect(delegate.delegateTaskForTool).toHaveBeenLastCalledWith(
      'product-interviewer',
      expect.stringContaining('Bring a product interviewer agent to clarify this feature.'),
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
