/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import { filterToolsByRelevance, getToolCategory } from '../../src/core/toolFilter.js';
import type { LLMMessage } from '../../src/types.js';
import * as child_process from 'node:child_process';

// Mock node:child_process — must match the import specifier in projectTracker.ts
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('project_tracker tool', () => {
  describe('tool definition', () => {
    it('exists in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def).toBeDefined();
    });

    it('requires action parameter', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.parameters?.required).toContain('action');
    });

    it('has all action enum values', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      const actionProp = def!.parameters?.properties?.action;
      expect(actionProp?.enum).toEqual(['list_issues', 'get_issue', 'list_prs', 'get_pr', 'get_user']);
    });

    it('has state enum including merged', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      const stateProp = def!.parameters?.properties?.state;
      expect(stateProp?.enum).toContain('merged');
    });

    it('does not require approval (read-only)', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.requiresApproval).toBeUndefined();
    });

    it('description instructs LLM to prefer MCP when available', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker');
      expect(def!.description).toContain('MCP');
    });
  });

  describe('tool categorization', () => {
    it('is categorized as git_read', () => {
      expect(getToolCategory('project_tracker')).toBe('git_read');
    });
  });

  describe('relevance filtering', () => {
    it('is included when user mentions issues', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'show me the open issues assigned to me' }];
      const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
      const filtered = filterToolsByRelevance([toolDef], messages);
      expect(filtered).toHaveLength(1);
    });

    it('is included when user mentions pull requests', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'list the pull requests for this repo' }];
      const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
      const filtered = filterToolsByRelevance([toolDef], messages);
      expect(filtered).toHaveLength(1);
    });

    it('is excluded when conversation has no tracker keywords', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'hello world' }];
      const toolDef = DEFAULT_TOOL_DEFINITIONS.find((t) => t.name === 'project_tracker')!;
      const filtered = filterToolsByRelevance([toolDef], messages);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('projectTracker execution', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns error when gh is not installed', async () => {
      const mockExecFile = vi.mocked(child_process.execFile);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
        const err = new Error('command not found: gh') as Error & { code?: string };
        err.code = 'ENOENT';
        cb(err, '', '');
        return {} as any;
      });

      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      const result = await projectTracker({
        type: 'project_tracker',
        action: 'get_user',
      });
      expect(result).toContain('gh CLI is not installed');
    });

    it('returns error when number is missing for get_issue', async () => {
      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      const result = await projectTracker({
        type: 'project_tracker',
        action: 'get_issue',
      });
      expect(result).toContain("'number' parameter is required");
    });

    it('returns error when merged state used with list_issues', async () => {
      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      const result = await projectTracker({
        type: 'project_tracker',
        action: 'list_issues',
        state: 'merged',
      });
      expect(result).toContain("'merged' state is only valid for list_prs");
    });

    it('builds correct gh command for list_issues with filters', async () => {
      const mockExecFile = vi.mocked(child_process.execFile);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
        cb(null, '[]', '');
        return {} as any;
      });

      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      await projectTracker({
        type: 'project_tracker',
        action: 'list_issues',
        assignee: '@me',
        state: 'open',
        labels: 'bug,urgent',
        limit: 10,
      });

      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('gh');
      const args = callArgs[1] as string[];
      expect(args).toContain('issue');
      expect(args).toContain('list');
      expect(args).toContain('--assignee');
      expect(args).toContain('@me');
      expect(args).toContain('--state');
      expect(args).toContain('open');
      expect(args).toContain('--label');
      expect(args).toContain('bug,urgent');
      const limitIdx = args.indexOf('--limit');
      expect(args[limitIdx + 1]).toBe('10');
    });

    it('builds correct gh command for get_pr', async () => {
      const mockExecFile = vi.mocked(child_process.execFile);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
        cb(null, '{}', '');
        return {} as any;
      });

      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      await projectTracker({
        type: 'project_tracker',
        action: 'get_pr',
        number: 42,
        repo: 'owner/repo',
      });

      const callArgs = mockExecFile.mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain('pr');
      expect(args).toContain('view');
      expect(args).toContain('42');
      expect(args).toContain('-R');
      expect(args).toContain('owner/repo');
    });

    it('returns authenticated user for get_user', async () => {
      const mockExecFile = vi.mocked(child_process.execFile);
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        const cb = (typeof _opts === 'function' ? _opts : callback) as Function;
        cb(null, 'octocat\n', '');
        return {} as any;
      });

      const { projectTracker } = await import('../../src/actions/projectTracker.js');
      const result = await projectTracker({
        type: 'project_tracker',
        action: 'get_user',
      });
      expect(result).toContain('octocat');
    });
  });
});
