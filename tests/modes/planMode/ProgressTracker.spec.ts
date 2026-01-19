/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ProgressTracker', () => {
  const createTestPlan = () => ({
    id: 'test-plan',
    steps: [
      { number: 1, description: 'First step', status: 'pending' as const },
      { number: 2, description: 'Second step', status: 'pending' as const },
      { number: 3, description: 'Third step', status: 'pending' as const },
      { number: 4, description: 'Fourth step', status: 'pending' as const },
    ],
    rawText: '1. First step\n2. Second step\n3. Third step\n4. Fourth step',
    createdAt: Date.now(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processOutput', () => {
    it('should detect [DONE:n] markers and mark steps as completed', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('Completed first task [DONE:1]');

      expect(plan.steps[0].status).toBe('completed');
    });

    it('should detect multiple [DONE:n] markers in same output', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('Done with step [DONE:1] and also [DONE:2]');

      expect(plan.steps[0].status).toBe('completed');
      expect(plan.steps[1].status).toBe('completed');
    });

    it('should handle out-of-order completion markers', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:3] completed before [DONE:1]');

      expect(plan.steps[0].status).toBe('completed');
      expect(plan.steps[2].status).toBe('completed');
      expect(plan.steps[1].status).toBe('pending'); // Step 2 not marked
    });

    it('should ignore invalid step numbers', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:99]'); // Step 99 doesn't exist

      expect(plan.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it('should not re-complete already completed steps', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);
      const callback = vi.fn();

      tracker.on('step:completed', callback);

      tracker.processOutput('[DONE:1]');
      tracker.processOutput('[DONE:1]'); // Same step again

      // Should only emit once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should set completedAt timestamp when marking step complete', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      const beforeMark = Date.now();
      tracker.processOutput('[DONE:1]');
      const afterMark = Date.now();

      expect(plan.steps[0].completedAt).toBeGreaterThanOrEqual(beforeMark);
      expect(plan.steps[0].completedAt).toBeLessThanOrEqual(afterMark);
    });

    it('should emit "step:completed" event with step data', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);
      const callback = vi.fn();

      tracker.on('step:completed', callback);
      tracker.processOutput('[DONE:2]');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 2,
          description: 'Second step',
          status: 'completed',
        })
      );
    });
  });

  describe('getProgress', () => {
    it('should return current progress as completed/total/percentage', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      const progress = tracker.getProgress();

      expect(progress.current).toBe(0);
      expect(progress.total).toBe(4);
      expect(progress.percentage).toBe(0);
    });

    it('should update progress after completing steps', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:1]');
      tracker.processOutput('[DONE:2]');

      const progress = tracker.getProgress();

      expect(progress.current).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.percentage).toBe(50);
    });

    it('should show 100% when all steps complete', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:1][DONE:2][DONE:3][DONE:4]');

      const progress = tracker.getProgress();

      expect(progress.current).toBe(4);
      expect(progress.percentage).toBe(100);
    });

    it('should round percentage to nearest integer', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan(); // 4 steps
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:1]'); // 1/4 = 25%

      const progress = tracker.getProgress();
      expect(progress.percentage).toBe(25);
    });
  });

  describe('markCompleted', () => {
    it('should manually mark a step as completed', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.markCompleted(2);

      expect(plan.steps[1].status).toBe('completed');
    });

    it('should emit event when manually marking complete', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);
      const callback = vi.fn();

      tracker.on('step:completed', callback);
      tracker.markCompleted(3);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ number: 3 })
      );
    });
  });

  describe('markInProgress', () => {
    it('should mark a step as in_progress', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.markInProgress(1);

      expect(plan.steps[0].status).toBe('in_progress');
    });

    it('should emit "step:started" event', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);
      const callback = vi.fn();

      tracker.on('step:started', callback);
      tracker.markInProgress(2);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ number: 2 })
      );
    });
  });

  describe('getCurrentStep', () => {
    it('should return the first in_progress step', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.markInProgress(2);

      const current = tracker.getCurrentStep();

      expect(current?.number).toBe(2);
    });

    it('should return null if no step is in progress', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      const current = tracker.getCurrentStep();

      expect(current).toBeNull();
    });
  });

  describe('isComplete', () => {
    it('should return false when steps are pending', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      expect(tracker.isComplete()).toBe(false);
    });

    it('should return true when all steps are completed', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);

      tracker.processOutput('[DONE:1][DONE:2][DONE:3][DONE:4]');

      expect(tracker.isComplete()).toBe(true);
    });

    it('should emit "plan:completed" when all steps done', async () => {
      const { ProgressTracker } = await import('../../../src/modes/planMode/ProgressTracker.js');
      const plan = createTestPlan();
      const tracker = new ProgressTracker(plan);
      const callback = vi.fn();

      tracker.on('plan:completed', callback);
      tracker.processOutput('[DONE:1][DONE:2][DONE:3][DONE:4]');

      expect(callback).toHaveBeenCalled();
    });
  });
});
