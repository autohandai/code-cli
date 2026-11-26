/**
 * Auto-Mode State Management
 *
 * Stores each auto-mode run in a private directory outside the project.
 *
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveAutohandHome } from '../constants.js';
import { defineStateMachine, StateMachine } from '../utils/stateMachine.js';
import type {
  AutomodeSessionState,
  AutomodeIterationLog,
  AutomodeCircuitBreaker,
  AutomodeStatus,
  AutomodeCancelReason,
} from '../types.js';

const LEGACY_STATE_FILE_PATH = '.autohand/automode.local.md';

export async function hasLegacyAutomodeState(workspaceRoot: string): Promise<boolean> {
  return fs.pathExists(path.join(workspaceRoot, LEGACY_STATE_FILE_PATH));
}

/**
 * Persisted run status. Each event is named after the status it moves to, and a
 * finished run (cancelled, completed, failed) can never be reopened or rewritten.
 */
export const AUTOMODE_STATUS_TRANSITIONS = defineStateMachine<AutomodeStatus, AutomodeStatus>({
  name: 'automode-status',
  initial: 'running',
  transitions: {
    running: { paused: 'paused', cancelled: 'cancelled', completed: 'completed', failed: 'failed' },
    paused: { running: 'running', cancelled: 'cancelled', completed: 'completed', failed: 'failed' },
    cancelled: {},
    completed: {},
    failed: {},
  },
});

const isKnownStatus = (status: string): status is AutomodeStatus =>
  Object.prototype.hasOwnProperty.call(AUTOMODE_STATUS_TRANSITIONS.transitions, status);

/** Default circuit breaker thresholds */
const DEFAULT_THRESHOLDS = {
  noProgress: 3,
  sameError: 5,
  testOnly: 3,
  sameFile: 3,
};

/**
 * AutomodeState manages the state file for auto-mode sessions
 */
export class AutomodeState {
  private readonly stateDirectory: string;
  private runDirectory: string;
  private state: AutomodeSessionState | null = null;
  private iterations: AutomodeIterationLog[] = [];
  private circuitBreaker: AutomodeCircuitBreaker = {
    noProgressCount: 0,
    sameErrorCount: 0,
    testOnlyCount: 0,
    sameFileRepeatCount: 0,
  };

  constructor(workspaceRoot: string, stateDirectory?: string) {
    const workspaceId = createHash('sha256').update(path.resolve(workspaceRoot)).digest('hex').slice(0, 16);
    this.stateDirectory = stateDirectory ?? path.join(resolveAutohandHome(), 'automode', workspaceId);
    this.runDirectory = path.join(this.stateDirectory, randomUUID());
  }

  /**
   * Get the state file path
   */
  getStatePath(): string {
    return path.join(this.runDirectory, 'automode.local.md');
  }

  /**
   * Check if an auto-mode session is active
   */
  async hasActiveSession(): Promise<boolean> {
    try {
      const exists = await fs.pathExists(this.getStatePath());
      if (!exists) return false;

      const state = await this.load();
      return state !== null && state.status === 'running';
    } catch {
      return false;
    }
  }

  /**
   * Initialize a new auto-mode session
   */
  async initialize(options: {
    sessionId: string;
    prompt: string;
    maxIterations: number;
    completionPromise: string;
    branch?: string;
    worktreePath?: string;
  }): Promise<AutomodeSessionState> {
    this.runDirectory = path.join(this.stateDirectory, randomUUID());
    this.state = {
      sessionId: options.sessionId,
      prompt: options.prompt,
      startedAt: new Date().toISOString(),
      currentIteration: 0,
      maxIterations: options.maxIterations,
      status: 'running',
      branch: options.branch,
      worktreePath: options.worktreePath,
      filesCreated: 0,
      filesModified: 0,
      completionPromise: options.completionPromise,
    };

    this.iterations = [];
    this.circuitBreaker = {
      noProgressCount: 0,
      sameErrorCount: 0,
      testOnlyCount: 0,
      sameFileRepeatCount: 0,
    };

    await this.save();
    return this.state;
  }

  /**
   * Load state from file
   */
  async load(): Promise<AutomodeSessionState | null> {
    try {
      const filePath = this.getStatePath();
      if (!await fs.pathExists(filePath)) {
        return null;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const state = this.parseStateMarkdown(content);
      this.state = state;
      return state;
    } catch (error) {
      console.error('[automode] Failed to load state:', error);
      return null;
    }
  }

  /**
   * Save state to file
   */
  async save(): Promise<void> {
    if (!this.state) return;

    try {
      const filePath = this.getStatePath();
      await fs.ensureDir(path.dirname(filePath), { mode: 0o700 });

      const content = this.formatStateMarkdown(this.state);
      await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 });
    } catch (error) {
      console.error('[automode] Failed to save state:', error);
    }
  }

  /**
   * Get current state
   */
  getState(): AutomodeSessionState | null {
    return this.state;
  }

  /**
   * Get all iteration logs
   */
  getIterations(): AutomodeIterationLog[] {
    return [...this.iterations];
  }

  /**
   * Update iteration count and track actions
   */
  async recordIteration(log: Omit<AutomodeIterationLog, 'iteration'>): Promise<void> {
    if (!this.state) return;

    this.state.currentIteration += 1;
    const iterationLog: AutomodeIterationLog = {
      ...log,
      iteration: this.state.currentIteration,
    };
    this.iterations.push(iterationLog);
    await this.save();
  }

  /**
   * Record a checkpoint (git commit)
   */
  async recordCheckpoint(commit: string, message: string): Promise<void> {
    if (!this.state) return;

    this.state.lastCheckpoint = {
      commit,
      message,
      timestamp: new Date().toISOString(),
    };

    // Also update the last iteration with checkpoint info
    if (this.iterations.length > 0) {
      const lastIteration = this.iterations[this.iterations.length - 1];
      lastIteration.checkpoint = { commit, message };
    }

    await this.save();
  }

  /**
   * Update file counts
   */
  async updateFileCounts(created: number, modified: number): Promise<void> {
    if (!this.state) return;

    this.state.filesCreated += created;
    this.state.filesModified += modified;
    await this.save();
  }

  /**
   * Move the run to `status` when the transition table allows it.
   * Returns false (and leaves the state untouched) for a refused transition.
   * A status this version does not recognise (older or hand-edited file) is
   * not validated, so such runs can still be closed.
   */
  async setStatus(
    status: AutomodeStatus,
    reason?: AutomodeCancelReason,
    errorMessage?: string
  ): Promise<boolean> {
    if (!this.state) return false;

    const current = this.state.status;
    if (isKnownStatus(current) && !new StateMachine(AUTOMODE_STATUS_TRANSITIONS, { initial: current }).can(status)) {
      return false;
    }

    this.state.status = status;
    if (reason) {
      this.state.cancelReason = reason;
    }
    if (errorMessage) {
      this.state.errorMessage = errorMessage;
    }
    await this.save();
    return true;
  }

  /**
   * Check and update circuit breaker state
   * Returns true if circuit breaker should trigger
   */
  checkCircuitBreaker(
    hasFileChanges: boolean,
    errorHash: string | null,
    isTestOnly: boolean,
    thresholds = DEFAULT_THRESHOLDS,
    modifiedFiles?: string[]
  ): { triggered: boolean; reason?: string } {
    // Check no progress
    if (!hasFileChanges) {
      this.circuitBreaker.noProgressCount += 1;
      if (this.circuitBreaker.noProgressCount >= thresholds.noProgress) {
        return {
          triggered: true,
          reason: `No file changes for ${this.circuitBreaker.noProgressCount} consecutive iterations`,
        };
      }
    } else {
      this.circuitBreaker.noProgressCount = 0;
    }

    // Check same error
    if (errorHash) {
      if (this.circuitBreaker.lastErrorHash === errorHash) {
        this.circuitBreaker.sameErrorCount += 1;
        if (this.circuitBreaker.sameErrorCount >= thresholds.sameError) {
          return {
            triggered: true,
            reason: `Same error for ${this.circuitBreaker.sameErrorCount} consecutive iterations`,
          };
        }
      } else {
        this.circuitBreaker.sameErrorCount = 1;
        this.circuitBreaker.lastErrorHash = errorHash;
      }
    } else {
      this.circuitBreaker.sameErrorCount = 0;
      this.circuitBreaker.lastErrorHash = undefined;
    }

    // Check test-only iterations
    if (isTestOnly) {
      this.circuitBreaker.testOnlyCount += 1;
      if (this.circuitBreaker.testOnlyCount >= thresholds.testOnly) {
        return {
          triggered: true,
          reason: `Only running tests for ${this.circuitBreaker.testOnlyCount} consecutive iterations`,
        };
      }
    } else {
      this.circuitBreaker.testOnlyCount = 0;
    }

    // Check same-file repetition: if the same file(s) are the only ones modified for N iterations
    if (modifiedFiles && modifiedFiles.length > 0) {
      const filesKey = [...modifiedFiles].sort().join('\n');
      if (this.circuitBreaker.lastModifiedFiles === filesKey) {
        this.circuitBreaker.sameFileRepeatCount += 1;
        const sameFileThreshold = thresholds.sameFile ?? DEFAULT_THRESHOLDS.sameFile;
        if (this.circuitBreaker.sameFileRepeatCount >= sameFileThreshold) {
          const fileList = modifiedFiles.length === 1
            ? modifiedFiles[0]
            : `${modifiedFiles.length} files`;
          return {
            triggered: true,
            reason: `Same file(s) modified for ${this.circuitBreaker.sameFileRepeatCount} consecutive iterations (${fileList})`,
          };
        }
      } else {
        this.circuitBreaker.sameFileRepeatCount = 1;
        this.circuitBreaker.lastModifiedFiles = filesKey;
      }
    } else if (!hasFileChanges) {
      // No files modified at all - don't reset same-file counter (handled by noProgress)
    } else {
      this.circuitBreaker.sameFileRepeatCount = 0;
      this.circuitBreaker.lastModifiedFiles = undefined;
    }

    return { triggered: false };
  }

  /**
   * Check if completion promise is in the output
   */
  checkCompletionPromise(output: string): boolean {
    if (!this.state) return false;

    const promise = this.state.completionPromise;
    // Check for both exact match and XML-style marker
    return (
      output.includes(promise) ||
      output.includes(`<promise>${promise}</promise>`)
    );
  }

  /**
   * Clean up state file after session ends
   */
  async cleanup(): Promise<void> {
    try {
      const filePath = this.getStatePath();
      if (await fs.pathExists(filePath)) {
        // Don't delete - keep for reference
        // Instead, mark as archived
        if (this.state?.status === 'running') {
          await this.setStatus('cancelled', 'error');
        }
      }
    } catch (error) {
      console.error('[automode] Failed to cleanup state:', error);
    }
  }

  /**
   * Parse state from markdown format
   */
  private parseStateMarkdown(content: string): AutomodeSessionState | null {
    try {
      // Extract key-value pairs from markdown
      const getValue = (key: string): string | undefined => {
        const regex = new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, 'i');
        const match = content.match(regex);
        return match?.[1]?.trim();
      };

      const sessionId = getValue('Session ID') ?? getValue('sessionId');
      const prompt = getValue('Prompt');
      const startedAt = getValue('Started');
      const currentIteration = parseInt(getValue('Current Iteration') ?? '0', 10);
      const maxIterations = parseInt(getValue('Max Iterations') ?? '50', 10);
      const status = (getValue('Status') ?? 'running') as AutomodeStatus;
      const branch = getValue('Branch');
      const worktreePath = getValue('Worktree');
      const filesCreated = parseInt(getValue('Files Created') ?? '0', 10);
      const filesModified = parseInt(getValue('Files Modified') ?? '0', 10);
      const completionPromise = getValue('Completion Promise') ?? 'DONE';

      if (!sessionId || !prompt || !startedAt) {
        return null;
      }

      return {
        sessionId,
        prompt,
        startedAt,
        currentIteration,
        maxIterations,
        status,
        branch,
        worktreePath,
        filesCreated,
        filesModified,
        completionPromise,
      };
    } catch {
      return null;
    }
  }

  /**
   * Format state as markdown
   */
  private formatStateMarkdown(state: AutomodeSessionState): string {
    const lines: string[] = [
      '# Auto-Mode State',
      '',
      '## Session',
      `- **Session ID:** ${state.sessionId}`,
      `- **Started:** ${state.startedAt}`,
      `- **Prompt:** ${state.prompt}`,
    ];

    if (state.branch) {
      lines.push(`- **Branch:** ${state.branch}`);
    }
    if (state.worktreePath) {
      lines.push(`- **Worktree:** ${state.worktreePath}`);
    }

    lines.push(
      '',
      '## Progress',
      `- **Current Iteration:** ${state.currentIteration}`,
      `- **Max Iterations:** ${state.maxIterations}`,
      `- **Status:** ${state.status}`,
      '',
      '## Metrics',
      `- **Files Created:** ${state.filesCreated}`,
      `- **Files Modified:** ${state.filesModified}`,
    );

    if (state.lastCheckpoint) {
      lines.push(
        '',
        '## Last Checkpoint',
        `- **Commit:** ${state.lastCheckpoint.commit}`,
        `- **Message:** ${state.lastCheckpoint.message}`,
        `- **Timestamp:** ${state.lastCheckpoint.timestamp}`,
      );
    }

    lines.push(
      '',
      '## Settings',
      `- **Completion Promise:** ${state.completionPromise}`,
    );

    if (state.cancelReason) {
      lines.push(`- **Cancel Reason:** ${state.cancelReason}`);
    }
    if (state.errorMessage) {
      lines.push(`- **Error:** ${state.errorMessage}`);
    }

    lines.push('');
    return lines.join('\n');
  }
}

/**
 * Create a simple hash of an error message for comparison
 */
export function hashError(error: string): string {
  // Simple hash - just use first 100 chars normalized
  return error
    .slice(0, 100)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
