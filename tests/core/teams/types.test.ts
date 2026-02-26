/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  TeamSchema,
  TeamTaskSchema,
  TeamMemberSchema,
  ProjectProfileSchema,
  ProjectSignalSchema,
} from '../../../src/core/teams/types.js';

describe('Team types', () => {
  it('should validate a valid Team', () => {
    const team = {
      name: 'code-cleanup',
      createdAt: new Date().toISOString(),
      leadSessionId: 'session-123',
      status: 'active',
      members: [],
    };
    expect(() => TeamSchema.parse(team)).not.toThrow();
  });

  it('should reject invalid team status', () => {
    const team = {
      name: 'code-cleanup',
      createdAt: new Date().toISOString(),
      leadSessionId: 'session-123',
      status: 'invalid',
      members: [],
    };
    expect(() => TeamSchema.parse(team)).toThrow();
  });

  it('should validate a TeamMember', () => {
    const member = {
      name: 'researcher',
      agentName: 'researcher',
      pid: 12345,
      status: 'idle',
    };
    expect(() => TeamMemberSchema.parse(member)).not.toThrow();
  });

  it('should validate a TeamTask with blockedBy', () => {
    const task = {
      id: 'task-001',
      subject: 'Remove dead exports',
      description: 'Find and remove unused exports from src/utils/',
      status: 'pending',
      blockedBy: ['task-000'],
      createdAt: new Date().toISOString(),
    };
    expect(() => TeamTaskSchema.parse(task)).not.toThrow();
  });

  it('should validate a ProjectSignal', () => {
    const signal = {
      type: 'dead-code',
      severity: 'high',
      count: 15,
      locations: ['src/utils/old.ts', 'src/legacy/index.ts'],
    };
    expect(() => ProjectSignalSchema.parse(signal)).not.toThrow();
  });

  it('should validate a ProjectProfile', () => {
    const profile = {
      repoRoot: '/home/user/project',
      languages: ['typescript'],
      frameworks: ['ink', 'commander'],
      structure: { hasDocs: false, hasTests: true, hasCI: true },
      signals: [],
      generatedAgents: [],
      analyzedAt: new Date().toISOString(),
    };
    expect(() => ProjectProfileSchema.parse(profile)).not.toThrow();
  });
});
