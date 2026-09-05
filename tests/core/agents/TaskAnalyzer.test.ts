/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeTask,
  CAPABILITY_DEFINITIONS,
} from '../../../src/core/agents/TaskAnalyzer.js';
import type { ProjectProfile } from '../../../src/core/teams/types.js';

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

describe('CAPABILITY_DEFINITIONS', () => {
  it('covers the built-in specialist roles with triggers and repo affinity', () => {
    const ids = CAPABILITY_DEFINITIONS.map((c) => c.id);
    expect(ids).toContain('testing');
    expect(ids).toContain('security');
    expect(ids).toContain('docs-writer');
    expect(ids).toContain('code-cleaner');
    expect(ids).toContain('planner');
    expect(ids).toContain('debugger');
    expect(ids).toContain('review');
    expect(ids).toContain('research');
    expect(ids).toContain('release-readiness');
    expect(ids).toContain('todo-resolver');
  });

  it('defines triggers and repoAffinity for every capability', () => {
    for (const capability of CAPABILITY_DEFINITIONS) {
      expect(capability.triggers.length).toBeGreaterThan(0);
      expect(capability.repoAffinity).toBeDefined();
    }
  });

  it('routes review work to the Autohand Review specialist first', () => {
    const review = CAPABILITY_DEFINITIONS.find((capability) => capability.id === 'review');

    expect(review?.preferredAgents[0]).toBe('autohand-review');
  });
});

describe('analyzeTask', () => {
  it('infers testing and security capabilities from task language without explicit roles', () => {
    const request = analyzeTask('add tests for the auth middleware');
    expect(request.requestedRoles).toEqual(['testing', 'security']);
  });

  it('unions explicit roles with trigger-inferred capabilities, deduped and order-preserving', () => {
    const request = analyzeTask('Bring a team of security and testing agents to write tests for auth');
    expect(request.requestedRoles).toEqual(['security', 'testing']);
  });

  it('keeps unknown explicit roles as unresolved rather than dropping them', () => {
    const request = analyzeTask('Bring a team of api-design and security agents to review this');
    expect(request.requestedRoles).toContain('api-design');
    expect(request.requestedRoles).toContain('security');
  });

  it('boosts capabilities whose repoAffinity matches profile signals', () => {
    const request = analyzeTask('improve the project', profile({
      signals: [{ type: 'missing-tests', severity: 'medium', count: 1, locations: [] }],
    }));
    expect(request.requestedRoles).toContain('testing');
  });

  it('returns an empty role list for a task with no triggers or explicit roles', () => {
    const request = analyzeTask('hello world');
    expect(request.requestedRoles).toEqual([]);
  });

  it('preserves the source and execution mode contract', () => {
    const request = analyzeTask('write tests for the auth middleware');
    expect(request.source).toBe('intent');
    expect(request.executionMode).toBeDefined();
  });
});
