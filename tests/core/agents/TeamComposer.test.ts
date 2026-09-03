/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { AgentDefinition, AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import type { SpecialistCatalogAdapter } from '../../../src/core/agents/SpecialistOrchestrator.js';
import {
  TeamComposer,
} from '../../../src/core/agents/TeamComposer.js';
import type { ProjectProfile } from '../../../src/core/teams/types.js';

function agent(
  name: string,
  source: AgentDefinition['source'],
  description = `${name} specialist`,
  tools: string[] = ['read_file'],
): AgentDefinition {
  return {
    name,
    source,
    description,
    systemPrompt: `Act as ${name}.`,
    tools,
    path: `/agents/${name}.md`,
  };
}

function registryWith(definitions: AgentDefinition[]): AgentRegistry {
  return {
    loadAgents: async () => undefined,
    getAllAgents: () => definitions,
  } as unknown as AgentRegistry;
}

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    repoRoot: '/repo',
    languages: ['typescript'],
    frameworks: ['ink'],
    structure: { hasDocs: true, hasTests: true, hasCI: true },
    signals: [],
    generatedAgents: [],
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

const catalog: SpecialistCatalogAdapter = {
  fetchRegistry: async () => ({
    schemaVersion: 1,
    repository: 'https://github.com/autohandai/awesome-sub-agents',
    agents: [],
  }),
  install: async () => 'Installed sub-agent',
};

describe('TeamComposer composition', () => {
  it('selects at most maxTeammates agents', async () => {
    const composer = new TeamComposer({
      registry: registryWith([
        agent('tester', 'builtin', 'writes tests'),
        agent('security-auditor', 'builtin', 'audits security'),
        agent('reviewer', 'builtin', 'reviews code'),
        agent('docs-writer', 'builtin', 'writes docs'),
        agent('planner', 'builtin', 'plans work'),
        agent('researcher', 'builtin', 'researches'),
        agent('debugger', 'builtin', 'debugs'),
      ]),
      catalog,
      maxTeammates: 3,
    });

    const composition = await composer.compose({
      objective: 'add tests for the auth middleware',
      requestedRoles: ['testing', 'security', 'review', 'docs-writer', 'planner'],
      source: 'tool',
      executionMode: 'serial',
    });

    expect(composition.selectedAgents.length).toBeLessThanOrEqual(3);
    expect(composition.selectedAgents.length).toBeGreaterThan(0);
  });

  it('emits phase-ordered tasks with valid blockedBy edges and no cycles', async () => {
    const composer = new TeamComposer({
      registry: registryWith([
        agent('tester', 'builtin', 'writes tests'),
        agent('security-auditor', 'builtin', 'audits security'),
        agent('reviewer', 'builtin', 'reviews code'),
      ]),
      catalog,
      maxTeammates: 5,
    });

    const composition = await composer.compose({
      objective: 'add tests for the auth middleware',
      requestedRoles: ['testing', 'security', 'review'],
      source: 'tool',
      executionMode: 'serial',
    });

    const tasks = composition.tasks;
    expect(tasks.length).toBeGreaterThan(0);
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      for (const dep of task.blockedBy) {
        expect(taskIds.has(dep)).toBe(true);
      }
    }
    // No cycles: every task's transitive deps never include itself.
    for (const task of tasks) {
      const visited = new Set<string>();
      const stack = [...task.blockedBy];
      while (stack.length > 0) {
        const dep = stack.pop()!;
        expect(dep).not.toBe(task.id);
        if (visited.has(dep)) continue;
        visited.add(dep);
        const depTask = tasks.find((t) => t.id === dep);
        if (depTask) stack.push(...depTask.blockedBy);
      }
    }
  });

  it('ranks tester above unrelated agents when the profile signals missing-tests', async () => {
    const composer = new TeamComposer({
      registry: registryWith([
        agent('tester', 'builtin', 'writes tests'),
        agent('docs-writer', 'builtin', 'writes docs'),
        agent('security-auditor', 'builtin', 'audits security'),
      ]),
      catalog,
      profile: profile({
        signals: [{ type: 'missing-tests', severity: 'medium', count: 1, locations: [] }],
      }),
      maxTeammates: 5,
    });

    const composition = await composer.compose({
      objective: 'improve the project',
      requestedRoles: ['testing'],
      source: 'tool',
      executionMode: 'serial',
    });

    expect(composition.selectedAgents[0].agentName).toBe('tester');
  });

  it('surfaces unresolved roles', async () => {
    const composer = new TeamComposer({
      registry: registryWith([agent('tester', 'builtin', 'writes tests')]),
      catalog,
      maxTeammates: 5,
    });

    const composition = await composer.compose({
      objective: 'bring an api-design specialist',
      requestedRoles: ['api-design', 'testing'],
      source: 'tool',
      executionMode: 'serial',
    });

    expect(composition.unresolvedRoles).toContain('api-design');
  });

  it('includes a review fan-in task blocked by implementation tasks', async () => {
    const composer = new TeamComposer({
      registry: registryWith([
        agent('tester', 'builtin', 'writes tests'),
        agent('security-auditor', 'builtin', 'audits security'),
        agent('reviewer', 'builtin', 'reviews code'),
      ]),
      catalog,
      maxTeammates: 5,
    });

    const composition = await composer.compose({
      objective: 'add tests for the auth middleware',
      requestedRoles: ['testing', 'security', 'review'],
      source: 'tool',
      executionMode: 'serial',
    });

    const reviewTask = composition.tasks.find((t) => t.subject.toLowerCase().includes('review'));
    expect(reviewTask).toBeDefined();
    expect(reviewTask!.blockedBy.length).toBeGreaterThan(0);
  });

  it('produces a readable roster line per member', async () => {
    const composer = new TeamComposer({
      registry: registryWith([
        agent('tester', 'builtin', 'writes tests'),
        agent('security-auditor', 'builtin', 'audits security'),
      ]),
      catalog,
      maxTeammates: 5,
    });

    const composition = await composer.compose({
      objective: 'add tests for the auth middleware',
      requestedRoles: ['testing', 'security'],
      source: 'tool',
      executionMode: 'serial',
    });

    const roster = TeamComposer.formatRoster(composition);
    expect(roster).toContain('tester');
    expect(roster).toContain('security-auditor');
  });
});