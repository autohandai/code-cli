/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

describe('/history command', () => {
  describe('formatHistoryEntry', () => {
    it('formats a session entry with all fields', async () => {
      const { formatHistoryEntry } = await import('../../src/commands/history.js');

      const entry = {
        sessionId: 'abc-123',
        createdAt: '2025-06-15T10:30:00.000Z',
        lastActiveAt: '2025-06-15T11:00:00.000Z',
        projectPath: '/home/user/my-project',
        projectName: 'my-project',
        model: 'anthropic/claude-sonnet-4-20250514',
        messageCount: 12,
        status: 'completed' as const,
      };

      const formatted = formatHistoryEntry(entry);

      expect(formatted).toContain('abc-123');
      expect(formatted).toContain('my-project');
      expect(formatted).toContain('12');
      expect(formatted).toContain('claude-sonnet');
    });

    it('shows [active] badge for active sessions', async () => {
      const { formatHistoryEntry } = await import('../../src/commands/history.js');

      const entry = {
        sessionId: 'active-session-1',
        createdAt: '2025-06-15T10:30:00.000Z',
        lastActiveAt: '2025-06-15T11:00:00.000Z',
        projectPath: '/home/user/project',
        projectName: 'project',
        model: 'gpt-4o',
        messageCount: 5,
        status: 'active' as const,
      };

      const formatted = formatHistoryEntry(entry);

      expect(formatted).toContain('[active]');
    });

    it('does not show [active] badge for completed sessions', async () => {
      const { formatHistoryEntry } = await import('../../src/commands/history.js');

      const entry = {
        sessionId: 'done-session-1',
        createdAt: '2025-06-15T10:30:00.000Z',
        lastActiveAt: '2025-06-15T11:00:00.000Z',
        projectPath: '/home/user/project',
        projectName: 'project',
        model: 'gpt-4o',
        messageCount: 3,
        status: 'completed' as const,
      };

      const formatted = formatHistoryEntry(entry);

      expect(formatted).not.toContain('[active]');
    });

    it('formats the date portion of the entry', async () => {
      const { formatHistoryEntry } = await import('../../src/commands/history.js');

      const entry = {
        sessionId: 'date-test-1',
        createdAt: '2025-01-20T14:30:00.000Z',
        lastActiveAt: '2025-01-20T15:00:00.000Z',
        projectPath: '/home/user/project',
        projectName: 'project',
        model: 'gpt-4o',
        messageCount: 1,
        status: 'completed' as const,
      };

      const formatted = formatHistoryEntry(entry);

      // Should contain some date representation (Jan 20 or 1/20 etc.)
      expect(formatted).toContain('Jan');
    });
  });

  describe('paginateHistory', () => {
    const makeEntries = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        sessionId: `session-${i}`,
        createdAt: new Date(2025, 0, i + 1).toISOString(),
        lastActiveAt: new Date(2025, 0, i + 1).toISOString(),
        projectPath: `/home/user/project-${i}`,
        projectName: `project-${i}`,
        model: 'gpt-4o',
        messageCount: i + 1,
        status: 'completed' as const,
      }));

    it('returns the correct page of items with default pageSize', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(30);

      const result = paginateHistory(entries, 1, 15);

      expect(result.items).toHaveLength(15);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(2);
      expect(result.totalItems).toBe(30);
    });

    it('returns fewer items on the last page', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(20);

      const result = paginateHistory(entries, 2, 15);

      expect(result.items).toHaveLength(5);
      expect(result.currentPage).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.totalItems).toBe(20);
    });

    it('returns empty items for out-of-range pages', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(10);

      const result = paginateHistory(entries, 5, 15);

      expect(result.items).toHaveLength(0);
      expect(result.currentPage).toBe(5);
      expect(result.totalPages).toBe(1);
      expect(result.totalItems).toBe(10);
    });

    it('returns empty items for page 0', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(10);

      const result = paginateHistory(entries, 0, 15);

      expect(result.items).toHaveLength(0);
      expect(result.currentPage).toBe(0);
      expect(result.totalPages).toBe(1);
      expect(result.totalItems).toBe(10);
    });

    it('handles empty entries array', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');

      const result = paginateHistory([], 1, 15);

      expect(result.items).toHaveLength(0);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(0);
      expect(result.totalItems).toBe(0);
    });

    it('uses custom pageSize', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(25);

      const result = paginateHistory(entries, 1, 10);

      expect(result.items).toHaveLength(10);
      expect(result.totalPages).toBe(3);
    });

    it('handles exactly one page of items', async () => {
      const { paginateHistory } = await import('../../src/commands/history.js');
      const entries = makeEntries(15);

      const result = paginateHistory(entries, 1, 15);

      expect(result.items).toHaveLength(15);
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
    });
  });

  describe('metadata', () => {
    it('exports correct metadata', async () => {
      const { metadata } = await import('../../src/commands/history.js');

      expect(metadata.command).toBe('/history');
      expect(metadata.description).toBeTruthy();
      expect(metadata.implemented).toBe(true);
    });
  });
});
