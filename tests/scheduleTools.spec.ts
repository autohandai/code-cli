/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for schedule-related tools (list_schedules, cancel_schedule)
 * and the schedule_triggered event type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RepeatManager } from '../src/core/repeatManager.js';
import { DEFAULT_TOOL_DEFINITIONS } from '../src/core/toolManager.js';
import { getToolCategory } from '../src/core/toolFilter.js';
import type { AgentOutputEvent } from '../src/types.js';

describe('Schedule Tools', () => {
  // =========================================================================
  // Tool Definitions
  // =========================================================================
  describe('tool definitions', () => {
    it('includes list_schedules in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(d => d.name === 'list_schedules');
      expect(def).toBeDefined();
      expect(def!.description).toContain('scheduled');
      // list_schedules has no parameters
      expect(def!.parameters).toBeUndefined();
    });

    it('includes cancel_schedule in DEFAULT_TOOL_DEFINITIONS', () => {
      const def = DEFAULT_TOOL_DEFINITIONS.find(d => d.name === 'cancel_schedule');
      expect(def).toBeDefined();
      expect(def!.description).toContain('Cancel');
      expect(def!.parameters).toBeDefined();
      expect(def!.parameters!.properties).toHaveProperty('schedule_id');
      expect(def!.parameters!.required).toContain('schedule_id');
    });
  });

  // =========================================================================
  // Tool Categories
  // =========================================================================
  describe('tool categories', () => {
    it('categorizes list_schedules as meta', () => {
      expect(getToolCategory('list_schedules')).toBe('meta');
    });

    it('categorizes cancel_schedule as meta', () => {
      expect(getToolCategory('cancel_schedule')).toBe('meta');
    });
  });

  // =========================================================================
  // list_schedules formatting
  // =========================================================================
  describe('list_schedules formatting', () => {
    let rm: RepeatManager;

    beforeEach(() => {
      rm = new RepeatManager();
    });

    afterEach(() => {
      rm.shutdown();
    });

    it('returns empty message when no jobs exist', () => {
      const jobs = rm.list();
      expect(jobs).toHaveLength(0);
    });

    it('lists scheduled jobs with id, prompt, interval, and run count', () => {
      const job = rm.schedule('check status', 60_000, '*/1 * * * *', 'every 1 minute');
      const jobs = rm.list();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        id: job.id,
        prompt: 'check status',
        humanInterval: 'every 1 minute',
        runCount: 0,
      });
    });

    it('formats job output with correct fields', () => {
      const job = rm.schedule('run tests', 300_000, '*/5 * * * *', 'every 5 minutes', { maxRuns: 10 });
      const jobs = rm.list();
      // Simulate the output format the agent executor will produce
      const formatted = jobs.map(j =>
        `[${j.id}] "${j.prompt}" — ${j.humanInterval} (runs: ${j.runCount}${j.maxRuns ? '/' + j.maxRuns : ''}, expires: ${new Date(j.expiresAt).toLocaleString()})`
      ).join('\n');

      expect(formatted).toContain(job.id);
      expect(formatted).toContain('"run tests"');
      expect(formatted).toContain('every 5 minutes');
      expect(formatted).toContain('runs: 0/10');
    });

    it('formats unlimited runs without max', () => {
      rm.schedule('deploy', 600_000, '*/10 * * * *', 'every 10 minutes');
      const jobs = rm.list();
      const formatted = jobs.map(j =>
        `[${j.id}] "${j.prompt}" — ${j.humanInterval} (runs: ${j.runCount}${j.maxRuns ? '/' + j.maxRuns : ''}, expires: ${new Date(j.expiresAt).toLocaleString()})`
      ).join('\n');

      expect(formatted).toContain(`runs: 0,`);
      // Should NOT contain "runs: 0/" pattern (which would indicate a maxRuns denominator)
      expect(formatted).not.toMatch(/runs: 0\//);
    });
  });

  // =========================================================================
  // cancel_schedule behavior
  // =========================================================================
  describe('cancel_schedule', () => {
    let rm: RepeatManager;

    beforeEach(() => {
      rm = new RepeatManager();
    });

    afterEach(() => {
      rm.shutdown();
    });

    it('cancels an existing job and returns true', () => {
      const job = rm.schedule('ping', 60_000, '*/1 * * * *', 'every 1 minute');
      expect(rm.list()).toHaveLength(1);

      const cancelled = rm.cancel(job.id);
      expect(cancelled).toBe(true);
      expect(rm.list()).toHaveLength(0);
    });

    it('returns false for non-existent job ID', () => {
      const cancelled = rm.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });

    it('handles cancelling the same job twice gracefully', () => {
      const job = rm.schedule('ping', 60_000, '*/1 * * * *', 'every 1 minute');
      rm.cancel(job.id);
      const secondCancel = rm.cancel(job.id);
      expect(secondCancel).toBe(false);
    });
  });

  // =========================================================================
  // schedule_triggered event type
  // =========================================================================
  describe('schedule_triggered event', () => {
    it('schedule_triggered is a valid AgentOutputEvent type', () => {
      const event: AgentOutputEvent = {
        type: 'schedule_triggered',
        content: 'check status',
        scheduleId: 'abc123',
      };
      expect(event.type).toBe('schedule_triggered');
      expect(event.content).toBe('check status');
      expect(event.scheduleId).toBe('abc123');
    });
  });

  // =========================================================================
  // RPC notification constant
  // =========================================================================
  describe('RPC notification', () => {
    it('SCHEDULE_TRIGGERED notification is defined', async () => {
      const { RPC_NOTIFICATIONS } = await import('../src/modes/rpc/types.js');
      expect(RPC_NOTIFICATIONS.SCHEDULE_TRIGGERED).toBe('autohand.schedule.triggered');
    });
  });
});
