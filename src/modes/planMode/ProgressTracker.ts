/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Progress Tracker
 * Tracks plan execution progress via [DONE:n] markers
 */

import { EventEmitter } from 'node:events';
import type { Plan, PlanStep, PlanProgress } from './types.js';

/**
 * ProgressTracker - tracks [DONE:n] markers in LLM output
 */
export class ProgressTracker extends EventEmitter {
  private plan: Plan;
  private completedEmitted = false;

  constructor(plan: Plan) {
    super();
    this.plan = plan;
  }

  /**
   * Process LLM output text and detect [DONE:n] markers
   */
  processOutput(text: string): void {
    const donePattern = /\[DONE:(\d+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = donePattern.exec(text)) !== null) {
      const stepNumber = parseInt(match[1], 10);
      this.markCompleted(stepNumber);
    }
  }

  /**
   * Mark a step as completed by step number
   */
  markCompleted(stepNumber: number): void {
    const step = this.plan.steps.find(s => s.number === stepNumber);

    if (!step) {
      // Invalid step number, ignore
      return;
    }

    if (step.status === 'completed') {
      // Already completed, don't re-emit
      return;
    }

    step.status = 'completed';
    step.completedAt = Date.now();

    this.emit('step:completed', step);

    // Check if plan is complete
    if (this.isComplete() && !this.completedEmitted) {
      this.completedEmitted = true;
      this.emit('plan:completed');
    }
  }

  /**
   * Mark a step as in progress
   */
  markInProgress(stepNumber: number): void {
    const step = this.plan.steps.find(s => s.number === stepNumber);

    if (!step) {
      return;
    }

    step.status = 'in_progress';
    this.emit('step:started', step);
  }

  /**
   * Get current progress information
   */
  getProgress(): PlanProgress {
    const completed = this.plan.steps.filter(s => s.status === 'completed').length;
    const total = this.plan.steps.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      current: completed,
      total,
      percentage,
    };
  }

  /**
   * Get the currently in-progress step
   */
  getCurrentStep(): PlanStep | null {
    return this.plan.steps.find(s => s.status === 'in_progress') ?? null;
  }

  /**
   * Check if all steps are completed
   */
  isComplete(): boolean {
    return this.plan.steps.every(s => s.status === 'completed');
  }
}
