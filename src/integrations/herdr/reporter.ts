/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import type { HerdrEnvironment } from './environment.js';
import type { HerdrReport } from './stateMachine.js';

export const HERDR_SOURCE = 'autohand-code';
export const HERDR_AGENT_NAME = 'autohand';
export const HERDR_RESUME_COMMAND = 'autohand';

const REPORT_TIMEOUT_MS = 2_000;
/** Herdr rejects resume commands with apostrophes or control characters. */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Runs the Herdr CLI once; resolves when it exits or is abandoned, never rejects. */
export type HerdrCommandRunner = (binPath: string, args: readonly string[]) => Promise<void>;

export interface HerdrReporterOptions {
  environment: HerdrEnvironment;
  run?: HerdrCommandRunner;
  now?: () => number;
}

export function runHerdrCommand(binPath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binPath, [...args], { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, REPORT_TIMEOUT_MS);
    timer.unref();
    child.unref();
    child.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function buildHerdrResumeArgv(sessionId: string | null): string[] | null {
  if (!sessionId || !SAFE_SESSION_ID.test(sessionId)) return null;
  return [HERDR_RESUME_COMMAND, 'resume', sessionId];
}

export function buildHerdrReportArgs(report: HerdrReport, paneId: string, seq: number): string[] {
  const identity = [paneId, '--source', HERDR_SOURCE, '--agent', HERDR_AGENT_NAME, '--seq', String(seq)];
  if (report.kind === 'release') return ['pane', 'release-agent', ...identity];
  const args = ['pane', 'report-agent', ...identity, '--state', report.state];
  if (report.message) args.push('--message', report.message);
  if (report.sessionId) args.push('--agent-session-id', report.sessionId);
  const resume = buildHerdrResumeArgv(report.sessionId);
  if (resume) args.push('--', ...resume);
  return args;
}

/**
 * Delivers reports to the Herdr pane without ever slowing the agent down:
 * one Herdr call in flight at a time, newer reports replace queued ones, and
 * every call carries a sequence number that keeps increasing across restarts.
 */
export class HerdrReporter {
  private readonly environment: HerdrEnvironment;
  private readonly run: HerdrCommandRunner;
  private readonly now: () => number;
  private lastSeq = 0;
  private pending: HerdrReport | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: HerdrReporterOptions) {
    this.environment = options.environment;
    this.run = options.run ?? runHerdrCommand;
    this.now = options.now ?? Date.now;
  }

  report(report: HerdrReport): void {
    this.pending = report;
    if (!this.inFlight) this.inFlight = this.drain();
  }

  /** Resolves once every queued report has been handed to Herdr. */
  settled(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const report = this.pending;
      this.pending = null;
      const args = buildHerdrReportArgs(report, this.environment.paneId, this.nextSeq());
      try {
        await this.run(this.environment.binPath, args);
      } catch {
        // Herdr is an observer; a lost report must never surface to the user.
      }
    }
    this.inFlight = null;
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(this.lastSeq + 1, this.now());
    return this.lastSeq;
  }
}
