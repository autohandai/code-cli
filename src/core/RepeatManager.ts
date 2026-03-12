/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * RepeatManager — in-process scheduler for recurring prompts.
 * Jobs run at a fixed interval using setInterval and auto-expire after 3 days.
 */

import { randomUUID } from 'node:crypto';

export interface RepeatJob {
  id: string;
  prompt: string;
  intervalMs: number;
  cronExpression: string;
  humanInterval: string;
  createdAt: number;
  expiresAt: number;
  /** Maximum number of executions before auto-cancel. Undefined = unlimited. */
  maxRuns?: number;
  /** Number of times the job has triggered so far. */
  runCount: number;
}

export interface ScheduleOptions {
  /** Auto-cancel after this many executions. */
  maxRuns?: number;
  /** Custom expiry duration in ms (overrides the default 3 days). */
  expiresInMs?: number;
}

export type RepeatJobCallback = (job: RepeatJob) => void;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export class RepeatManager {
  private jobs = new Map<string, RepeatJob>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private callback: RepeatJobCallback | null = null;

  /**
   * Register the callback that fires each time a job triggers.
   */
  onTrigger(cb: RepeatJobCallback): void {
    this.callback = cb;
  }

  /**
   * Schedule a new recurring job.
   * Returns the created RepeatJob.
   */
  schedule(prompt: string, intervalMs: number, cronExpression: string, humanInterval: string, options?: ScheduleOptions): RepeatJob {
    const id = randomUUID().slice(0, 8);
    const now = Date.now();
    const expiresInMs = options?.expiresInMs ?? THREE_DAYS_MS;
    const job: RepeatJob = {
      id,
      prompt,
      intervalMs,
      cronExpression,
      humanInterval,
      createdAt: now,
      expiresAt: now + expiresInMs,
      maxRuns: options?.maxRuns,
      runCount: 0,
    };

    this.jobs.set(id, job);

    // Set up the recurring interval
    const timer = setInterval(() => {
      job.runCount++;
      if (this.callback) {
        this.callback(job);
      }
      // Auto-cancel when maxRuns limit reached
      if (job.maxRuns !== undefined && job.runCount >= job.maxRuns) {
        this.cancel(id);
      }
    }, intervalMs);

    // Prevent the interval from keeping the process alive
    if (timer.unref) timer.unref();

    this.timers.set(id, timer);

    // Set up auto-expiry
    const expiryTimer = setTimeout(() => {
      this.cancel(id);
    }, expiresInMs);

    if (expiryTimer.unref) expiryTimer.unref();

    this.expiryTimers.set(id, expiryTimer);

    return job;
  }

  /**
   * Cancel a scheduled job by ID.
   * Returns true if the job was found and cancelled.
   */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    const expiryTimer = this.expiryTimers.get(id);
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      this.expiryTimers.delete(id);
    }

    return this.jobs.delete(id);
  }

  /**
   * List all active jobs.
   */
  list(): RepeatJob[] {
    return [...this.jobs.values()];
  }

  /**
   * Cancel all jobs and clean up.
   */
  shutdown(): void {
    for (const id of this.jobs.keys()) {
      this.cancel(id);
    }
  }
}
