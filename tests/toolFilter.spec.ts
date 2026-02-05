/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  createToolFilter,
  getToolCategory,
} from '../src/core/toolFilter.js';
import type { ToolDefinition } from '../src/core/toolManager.js';

describe('ToolFilter', () => {
  const sampleTools: ToolDefinition[] = [
    { name: 'read_file', description: 'Read a file' },
    { name: 'write_file', description: 'Write a file' },
    { name: 'delete_path', description: 'Delete a path', requiresApproval: true },
    { name: 'run_command', description: 'Run shell command', requiresApproval: true },
    { name: 'git_status', description: 'Show git status' },
    { name: 'git_push', description: 'Push to remote', requiresApproval: true },
    { name: 'list_tree', description: 'List directory tree' },
    { name: 'plan', description: 'Create a plan' }
  ];

  describe('getToolCategory', () => {
    it('returns correct categories for known tools', () => {
      expect(getToolCategory('read_file')).toBe('read');
      expect(getToolCategory('write_file')).toBe('write');
      expect(getToolCategory('delete_path')).toBe('delete');
      expect(getToolCategory('run_command')).toBe('shell');
      expect(getToolCategory('git_status')).toBe('git_read');
      expect(getToolCategory('git_push')).toBe('git_write');
      expect(getToolCategory('plan')).toBe('meta');
    });

    it('returns meta for unknown tools', () => {
      expect(getToolCategory('unknown_tool')).toBe('meta');
    });
  });

  describe('CLI context (default)', () => {
    it('allows all tools', () => {
      const filter = createToolFilter('cli');
      expect(filter.isAllowed('read_file')).toBe(true);
      expect(filter.isAllowed('write_file')).toBe(true);
      expect(filter.isAllowed('delete_path')).toBe(true);
      expect(filter.isAllowed('run_command')).toBe(true);
      expect(filter.isAllowed('git_push')).toBe(true);
    });

    it('filters definitions to include all tools', () => {
      const filter = createToolFilter('cli');
      const filtered = filter.filterDefinitions(sampleTools);
      expect(filtered.length).toBe(sampleTools.length);
    });
  });

  describe('Slack context', () => {
    it('blocks file listing and shell commands', () => {
      const filter = createToolFilter('slack');
      expect(filter.isAllowed('list_tree')).toBe(false);
      expect(filter.isAllowed('run_command')).toBe(false);
      expect(filter.isAllowed('custom_command')).toBe(false);
      expect(filter.isAllowed('search')).toBe(false);
    });

    it('allows meta and git read tools', () => {
      const filter = createToolFilter('slack');
      expect(filter.isAllowed('plan')).toBe(true);
      expect(filter.isAllowed('git_status')).toBe(true);
    });

    it('blocks write operations', () => {
      const filter = createToolFilter('slack');
      expect(filter.isAllowed('write_file')).toBe(false);
      expect(filter.isAllowed('delete_path')).toBe(false);
    });

    it('filters definitions correctly', () => {
      const filter = createToolFilter('slack');
      const filtered = filter.filterDefinitions(sampleTools);
      const names = filtered.map(t => t.name);
      expect(names).toContain('git_status');
      expect(names).toContain('plan');
      expect(names).not.toContain('list_tree');
      expect(names).not.toContain('run_command');
      expect(names).not.toContain('write_file');
    });
  });

  describe('API context', () => {
    it('blocks dangerous operations', () => {
      const filter = createToolFilter('api');
      expect(filter.isAllowed('delete_path')).toBe(false);
      expect(filter.isAllowed('run_command')).toBe(false);
      expect(filter.isAllowed('git_push')).toBe(false);
      expect(filter.isAllowed('git_reset')).toBe(false);
    });

    it('allows read and write operations', () => {
      const filter = createToolFilter('api');
      expect(filter.isAllowed('read_file')).toBe(true);
      expect(filter.isAllowed('write_file')).toBe(true);
      expect(filter.isAllowed('git_status')).toBe(true);
    });

    it('forces approval for git_commit', () => {
      const filter = createToolFilter('api');
      expect(filter.requiresApproval('git_commit', false)).toBe(true);
    });
  });

  describe('Restricted context', () => {
    it('only allows read operations', () => {
      const filter = createToolFilter('restricted');
      expect(filter.isAllowed('read_file')).toBe(true);
      expect(filter.isAllowed('git_status')).toBe(true);
      expect(filter.isAllowed('plan')).toBe(true);
    });

    it('blocks all write operations', () => {
      const filter = createToolFilter('restricted');
      expect(filter.isAllowed('write_file')).toBe(false);
      expect(filter.isAllowed('delete_path')).toBe(false);
      expect(filter.isAllowed('run_command')).toBe(false);
      expect(filter.isAllowed('git_push')).toBe(false);
    });

    it('blocks list_tree for privacy', () => {
      const filter = createToolFilter('restricted');
      expect(filter.isAllowed('list_tree')).toBe(false);
    });
  });

  describe('Custom policy', () => {
    it('allows extending blocklist', () => {
      const filter = createToolFilter('cli', {
        blockedTools: ['git_push', 'git_reset']
      });
      expect(filter.isAllowed('read_file')).toBe(true);
      expect(filter.isAllowed('git_push')).toBe(false);
      expect(filter.isAllowed('git_reset')).toBe(false);
    });

    it('allows explicit allowlist', () => {
      const filter = createToolFilter('cli', {
        allowedTools: ['read_file', 'git_status']
      });
      expect(filter.isAllowed('read_file')).toBe(true);
      expect(filter.isAllowed('git_status')).toBe(true);
      expect(filter.isAllowed('write_file')).toBe(false);
    });

    it('allows adding approval requirements', () => {
      const filter = createToolFilter('cli', {
        requireApprovalFor: ['write_file']
      });
      expect(filter.requiresApproval('write_file', false)).toBe(true);
      expect(filter.requiresApproval('read_file', false)).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('returns summary of allowed and blocked tools', () => {
      const filter = createToolFilter('restricted');
      const summary = filter.getSummary();
      expect(summary.categories).toContain('read');
      expect(summary.categories).toContain('git_read');
      expect(summary.categories).not.toContain('shell');
      expect(summary.allowed).toContain('read_file');
      expect(summary.blocked).toContain('run_command');
    });
  });
});
