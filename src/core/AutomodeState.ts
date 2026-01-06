/**
 * Auto-Mode State Management
 *
 * Handles reading/writing the .autohand/automode.local.md state file
 * that tracks auto-mode session progress.
 *
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'path';
import type {
  AutomodeSessionState,
  AutomodeIterationLog,
  AutomodeCircuitBreaker,
  AutomodeStatus,
  AutomodeCancelReason,
} from '../types.js';

/** Default state file path relative to workspace */
const STATE_FILE_PATH = '.autohand/automode.local.md';

/** Default circuit breaker thresholds */
const DEFAULT_THRESHOLDS = {
  noProgress: 3,
  sameError: 5,
  testOnly: 3,
};

/**
 * AutomodeState manages the state file for auto-mode sessions
 */
export class AutomodeState {
  private workspaceRoot: string;
  private state: AutomodeSessionState | null = null;
  private iterations: AutomodeIterationLog[] = [];
  private circuitBreaker: AutomodeCircuitBreaker = {
    noProgressCount: 0,
    sameErrorCount: 0,
    testOnlyCount: 0,
  };

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get the state file path
   */
  getStatePath(): string {
    return path.join(this.workspaceRoot, STATE_FILE_PATH);
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
      await fs.ensureDir(path.dirname(filePath));

      const content = this.formatStateMarkdown(this.state);
      await fs.writeFile(filePath, content, 'utf-8');
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
   * Update status
   */
  async setStatus(
    status: AutomodeStatus,
    reason?: AutomodeCancelReason,
    errorMessage?: string
  ): Promise<void> {
    if (!this.state) return;

    this.state.status = status;
    if (reason) {
      this.state.cancelReason = reason;
    }
    if (errorMessage) {
      this.state.errorMessage = errorMessage;
    }
    await this.save();
  }

  /**
   * Check and update circuit breaker state
   * Returns true if circuit breaker should trigger
   */
  checkCircuitBreaker(
    hasFileChanges: boolean,
    errorHash: string | null,
    isTestOnly: boolean,
    thresholds = DEFAULT_THRESHOLDS
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
        if (this.state && this.state.status === 'running') {
          this.state.status = 'cancelled';
          this.state.cancelReason = 'error';
          await this.save();
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
