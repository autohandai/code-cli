/**
 * Auto-Mode Manager
 *
 * Orchestrates the autonomous loop feature inspired by the Ralph technique.
 * Manages iteration cycles, git worktree isolation, checkpointing, and
 * cancellation via ESC, hooks, RPC, and ACP.
 *
 * @license Apache-2.0
 */
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import crypto from 'crypto';
import type {
  AutomodeSessionState,
  AutomodeIterationLog,
  AutomodeCancelReason,
  AutomodeSettings,
  CLIOptions,
  LoadedConfig,
} from '../types.js';
import { AutomodeState, hashError } from './AutomodeState.js';
import { generateChangelog } from './AutomodeChangelog.js';
import { PatternDetector, type ProjectPatterns } from './PatternDetector.js';
import { AgentsMdUpdater } from './AgentsMdUpdater.js';
import type { HookManager } from './HookManager.js';
import type { Session } from '../session/SessionManager.js';
import type { MemoryManager } from '../memory/MemoryManager.js';

/** Default auto-mode settings */
const DEFAULTS: Required<AutomodeSettings> = {
  maxIterations: 50,
  maxRuntime: 120, // minutes
  maxCost: 10, // dollars
  checkpointInterval: 5,
  completionPromise: 'DONE',
  useWorktree: true,
  noProgressThreshold: 3,
  sameErrorThreshold: 5,
  testOnlyThreshold: 3,
};

/** Auto-mode options from CLI */
export interface AutomodeOptions {
  prompt: string;
  maxIterations?: number;
  completionPromise?: string;
  useWorktree?: boolean;
  checkpointInterval?: number;
  maxRuntime?: number;
  maxCost?: number;
  dryRun?: boolean;
}

/** Iteration result from agent */
export interface IterationResult {
  success: boolean;
  actions: string[];
  output?: string;
  filesCreated?: number;
  filesModified?: number;
  tokensUsed?: number;
  cost?: number;
  error?: string;
}

/** Callback for running an iteration */
export type IterationCallback = (
  iteration: number,
  prompt: string,
  abortSignal: AbortSignal
) => Promise<IterationResult>;

/**
 * AutomodeManager orchestrates the auto-mode loop
 */
export class AutomodeManager extends EventEmitter {
  private config: LoadedConfig;
  private workspaceRoot: string;
  private hookManager?: HookManager;
  private session?: Session;
  private memoryManager?: MemoryManager;
  private patternDetector: PatternDetector;
  private agentsMdUpdater: AgentsMdUpdater;
  private state: AutomodeState;
  private settings: Required<AutomodeSettings>;
  private abortController: AbortController | null = null;
  private startTime: number = 0;
  private totalCost: number = 0;
  private worktreePath: string | null = null;
  private originalBranch: string | null = null;
  private branchName: string | null = null;
  private gitCommits: Array<{ hash: string; message: string }> = [];
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private detectedPatterns?: ProjectPatterns;

  constructor(
    config: LoadedConfig,
    workspaceRoot: string,
    hookManager?: HookManager,
    session?: Session,
    memoryManager?: MemoryManager
  ) {
    super();
    this.config = config;
    this.workspaceRoot = workspaceRoot;
    this.hookManager = hookManager;
    this.session = session;
    this.memoryManager = memoryManager;
    this.patternDetector = new PatternDetector(workspaceRoot);
    this.agentsMdUpdater = new AgentsMdUpdater(workspaceRoot);
    this.state = new AutomodeState(workspaceRoot);
    this.settings = {
      ...DEFAULTS,
      ...config.automode,
    };
  }

  /**
   * Check if auto-mode is currently running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Check if auto-mode is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get current state
   */
  getState(): AutomodeSessionState | null {
    return this.state.getState();
  }

  /**
   * Get the effective workspace path (worktree if set up, otherwise original)
   */
  getEffectiveWorkspace(): string {
    return this.worktreePath ?? this.workspaceRoot;
  }

  /**
   * Get the worktree path if set up
   */
  getWorktreePath(): string | null {
    return this.worktreePath;
  }

  /**
   * Get the branch name if worktree is set up
   */
  getBranchName(): string | null {
    return this.branchName;
  }

  /**
   * Prepare worktree for auto-mode (call before start if you need the workspace path)
   * Returns the worktree path if created, or null if worktree is disabled or failed
   */
  async prepareWorktree(useWorktree: boolean = true): Promise<string | null> {
    if (!useWorktree) {
      return null;
    }

    try {
      const sessionId = `automode-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      await this.setupWorktree(sessionId);
      return this.worktreePath;
    } catch (error) {
      console.log(chalk.yellow(`⚠ Worktree setup failed: ${error}`));
      console.log(chalk.gray('  Continuing in current workspace'));
      return null;
    }
  }

  /**
   * Start auto-mode loop
   */
  async start(
    options: AutomodeOptions,
    runIteration: IterationCallback
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('Auto-mode is already running');
    }

    // Check for existing session
    if (await this.state.hasActiveSession()) {
      const existingState = await this.state.load();
      if (existingState) {
        console.log(chalk.yellow(`\n⚠ Existing auto-mode session found: ${existingState.sessionId}`));
        console.log(chalk.gray(`  Status: ${existingState.status}, Iteration: ${existingState.currentIteration}`));
        console.log(chalk.gray(`  Use /automode resume to continue or /automode cancel to start fresh\n`));
        return;
      }
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.totalCost = 0;
    this.gitCommits = [];

    // Merge options with defaults
    const maxIterations = options.maxIterations ?? this.settings.maxIterations;
    const completionPromise = options.completionPromise ?? this.settings.completionPromise;
    const useWorktree = options.useWorktree ?? this.settings.useWorktree;
    const checkpointInterval = options.checkpointInterval ?? this.settings.checkpointInterval;
    const maxRuntime = options.maxRuntime ?? this.settings.maxRuntime;
    const maxCost = options.maxCost ?? this.settings.maxCost;

    // Generate session ID
    const sessionId = `automode-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    console.log(chalk.cyan('\n🔄 Starting Auto-Mode'));
    console.log(chalk.gray(`   Session: ${sessionId}`));
    console.log(chalk.gray(`   Max iterations: ${maxIterations}`));
    console.log(chalk.gray(`   Completion promise: "${completionPromise}"`));
    console.log(chalk.gray(`   Worktree isolation: ${useWorktree ? 'enabled' : 'disabled'}`));

    // Create worktree if enabled AND not already prepared
    if (useWorktree && !this.worktreePath) {
      try {
        await this.setupWorktree(sessionId);
        console.log(chalk.gray(`   Branch: ${this.branchName}`));
      } catch (error) {
        console.log(chalk.yellow(`   ⚠ Worktree setup failed, continuing in current branch`));
        console.log(chalk.gray(`   ${error}`));
      }
    } else if (this.worktreePath) {
      // Worktree was already prepared via prepareWorktree()
      console.log(chalk.gray(`   Branch: ${this.branchName}`));
      console.log(chalk.gray(`   Worktree: ${this.worktreePath}`));
    }

    // Initialize state
    await this.state.initialize({
      sessionId,
      prompt: options.prompt,
      maxIterations,
      completionPromise,
      branch: this.branchName ?? undefined,
      worktreePath: this.worktreePath ?? undefined,
    });

    console.log(chalk.cyan('\n   Press ESC to cancel auto-mode\n'));

    // Save initial prompt to session
    await this.session?.append({
      role: 'user',
      content: `[Auto-Mode Start] ${options.prompt}`,
      timestamp: new Date().toISOString(),
      _meta: {
        automode: true,
        sessionId,
        maxIterations,
        completionPromise,
      },
    });

    // Emit start event
    await this.emitHookEvent('automode:start', {
      automodeSessionId: sessionId,
      automodePrompt: options.prompt,
      automodeMaxIterations: maxIterations,
    });

    try {
      // Main loop
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        // Check for cancellation
        if (this.abortController.signal.aborted) {
          break;
        }

        // Check for pause
        while (this.isPaused && !this.abortController.signal.aborted) {
          await this.delay(500);
        }

        // Check runtime limit
        const elapsedMinutes = (Date.now() - this.startTime) / 60000;
        if (elapsedMinutes >= maxRuntime) {
          await this.cancel('max_runtime');
          break;
        }

        // Check cost limit
        if (this.totalCost >= maxCost) {
          await this.cancel('max_cost');
          break;
        }

        // Show progress
        console.log(chalk.cyan(`\n📍 Iteration ${iteration}/${maxIterations}`));

        // Run iteration
        const result = await runIteration(
          iteration,
          options.prompt,
          this.abortController.signal
        );

        // Track costs
        if (result.cost) {
          this.totalCost += result.cost;
        }

        // Save iteration to session
        await this.session?.append({
          role: 'assistant',
          content: result.output || `[Iteration ${iteration}] Actions: ${result.actions.join(', ')}`,
          timestamp: new Date().toISOString(),
          _meta: {
            automode: true,
            iteration,
            actions: result.actions,
            filesCreated: result.filesCreated,
            filesModified: result.filesModified,
            tokensUsed: result.tokensUsed,
            cost: result.cost,
            error: result.error,
          },
        });

        // Record iteration
        const iterationLog: Omit<AutomodeIterationLog, 'iteration'> = {
          timestamp: new Date().toISOString(),
          actions: result.actions,
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        };

        // Update file counts
        if (result.filesCreated || result.filesModified) {
          await this.state.updateFileCounts(
            result.filesCreated ?? 0,
            result.filesModified ?? 0
          );
        }

        // Emit iteration event
        await this.emitHookEvent('automode:iteration', {
          automodeSessionId: sessionId,
          automodeIteration: iteration,
          automodeActions: result.actions,
          tokensUsed: result.tokensUsed,
        });

        // Check circuit breaker
        const hasChanges = (result.filesCreated ?? 0) + (result.filesModified ?? 0) > 0;
        const errorHash = result.error ? hashError(result.error) : null;
        const isTestOnly = result.actions.every(a =>
          a.toLowerCase().includes('test') || a.toLowerCase().includes('spec')
        );

        const circuitResult = this.state.checkCircuitBreaker(
          hasChanges,
          errorHash,
          isTestOnly,
          {
            noProgress: this.settings.noProgressThreshold,
            sameError: this.settings.sameErrorThreshold,
            testOnly: this.settings.testOnlyThreshold,
          }
        );

        if (circuitResult.triggered) {
          console.log(chalk.yellow(`\n⚡ Circuit breaker triggered: ${circuitResult.reason}`));
          await this.cancel('circuit_breaker');
          break;
        }

        // Check for completion promise
        if (result.output && this.state.checkCompletionPromise(result.output)) {
          console.log(chalk.green(`\n✅ Completion promise detected!`));
          await this.complete();
          break;
        }

        // Checkpoint at intervals
        if (iteration % checkpointInterval === 0) {
          await this.createCheckpoint(iteration);
        }

        // Record iteration
        await this.state.recordIteration(iterationLog);
      }

      // Check if we hit max iterations
      const currentState = this.state.getState();
      if (currentState && currentState.status === 'running') {
        if (currentState.currentIteration >= maxIterations) {
          console.log(chalk.yellow(`\n⚠ Maximum iterations (${maxIterations}) reached`));
          await this.cancel('max_iterations');
        }
      }
    } catch (error) {
      console.error(chalk.red(`\n❌ Auto-mode error: ${error}`));
      await this.state.setStatus('failed', 'error', String(error));
      await this.emitHookEvent('automode:error', {
        automodeSessionId: sessionId,
        error: String(error),
      });
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Cancel the auto-mode loop
   */
  async cancel(reason: AutomodeCancelReason = 'user_cancel'): Promise<void> {
    if (!this.isRunning) return;

    console.log(chalk.yellow(`\n⚠ Auto-mode cancelled: ${reason}`));

    this.abortController?.abort();
    await this.state.setStatus('cancelled', reason);

    const currentState = this.state.getState();
    if (currentState) {
      // Save cancellation message to session
      await this.session?.append({
        role: 'assistant',
        content: `[Auto-Mode Cancelled] Reason: ${reason}. Stopped at iteration ${currentState.currentIteration}. Files created: ${currentState.filesCreated}, Files modified: ${currentState.filesModified}`,
        timestamp: new Date().toISOString(),
        _meta: {
          automode: true,
          status: 'cancelled',
          reason,
          iterations: currentState.currentIteration,
          filesCreated: currentState.filesCreated,
          filesModified: currentState.filesModified,
          totalCost: this.totalCost,
        },
      });

      await this.emitHookEvent('automode:cancel', {
        automodeSessionId: currentState.sessionId,
        automodeCancelReason: reason,
        automodeIteration: currentState.currentIteration,
      });
    }
  }

  /**
   * Pause the auto-mode loop
   */
  async pause(): Promise<void> {
    if (!this.isRunning || this.isPaused) return;

    this.isPaused = true;
    await this.state.setStatus('paused');

    const currentState = this.state.getState();
    if (currentState) {
      console.log(chalk.yellow(`\n⏸️ Auto-mode paused at iteration ${currentState.currentIteration}`));
      await this.emitHookEvent('automode:pause', {
        automodeSessionId: currentState.sessionId,
        automodeIteration: currentState.currentIteration,
      });
    }
  }

  /**
   * Resume the auto-mode loop
   */
  async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) return;

    this.isPaused = false;
    await this.state.setStatus('running');

    const currentState = this.state.getState();
    if (currentState) {
      console.log(chalk.cyan(`\n▶️ Auto-mode resumed at iteration ${currentState.currentIteration}`));
      await this.emitHookEvent('automode:resume', {
        automodeSessionId: currentState.sessionId,
        automodeIteration: currentState.currentIteration,
      });
    }
  }

  /**
   * Mark auto-mode as complete
   */
  private async complete(): Promise<void> {
    await this.state.setStatus('completed', 'completion');

    const currentState = this.state.getState();
    if (currentState) {
      // Detect project patterns
      try {
        this.detectedPatterns = await this.patternDetector.detect();
        await this.storeDetectedPatterns();
        console.log(chalk.gray(`   🔍 Detected patterns saved to memory`));

        // Update AGENTS.md
        await this.agentsMdUpdater.update({ patterns: this.detectedPatterns });
        console.log(chalk.gray(`   📝 AGENTS.md updated with project info`));
      } catch (error) {
        console.log(chalk.gray(`   ⚠ Pattern detection failed: ${error}`));
      }

      // Save completion message to session
      await this.session?.append({
        role: 'assistant',
        content: `[Auto-Mode Complete] Task completed successfully after ${currentState.currentIteration} iterations. Files created: ${currentState.filesCreated}, Files modified: ${currentState.filesModified}`,
        timestamp: new Date().toISOString(),
        _meta: {
          automode: true,
          status: 'completed',
          iterations: currentState.currentIteration,
          filesCreated: currentState.filesCreated,
          filesModified: currentState.filesModified,
          totalCost: this.totalCost,
          detectedPatterns: this.detectedPatterns,
        },
      });

      await this.emitHookEvent('automode:complete', {
        automodeSessionId: currentState.sessionId,
        automodeIteration: currentState.currentIteration,
        automodeFilesCreated: currentState.filesCreated,
        automodeFilesModified: currentState.filesModified,
      });

      // Merge worktree if using one
      if (this.worktreePath && this.branchName && this.originalBranch) {
        await this.mergeWorktree();
      }
    }
  }

  /**
   * Store detected patterns in project memory
   */
  private async storeDetectedPatterns(): Promise<void> {
    if (!this.memoryManager || !this.detectedPatterns) return;

    const patterns = this.detectedPatterns;

    // Store tech stack
    if (patterns.techStack.length > 0) {
      await this.memoryManager.store(
        `Tech Stack: ${patterns.techStack.join(', ')}`,
        'project',
        ['auto-detected', 'tech-stack'],
        'automode'
      );
    }

    // Store framework
    if (patterns.framework) {
      await this.memoryManager.store(
        `Framework: ${patterns.framework}`,
        'project',
        ['auto-detected', 'framework'],
        'automode'
      );
    }

    // Store package manager
    if (patterns.packageManager) {
      await this.memoryManager.store(
        `Package Manager: ${patterns.packageManager}`,
        'project',
        ['auto-detected', 'package-manager'],
        'automode'
      );
    }

    // Store test command
    if (patterns.testCommand) {
      await this.memoryManager.store(
        `Test Command: ${patterns.testCommand}`,
        'project',
        ['auto-detected', 'command', 'test'],
        'automode'
      );
    }

    // Store build command
    if (patterns.buildCommand) {
      await this.memoryManager.store(
        `Build Command: ${patterns.buildCommand}`,
        'project',
        ['auto-detected', 'command', 'build'],
        'automode'
      );
    }

    // Store lint command
    if (patterns.lintCommand) {
      await this.memoryManager.store(
        `Lint Command: ${patterns.lintCommand}`,
        'project',
        ['auto-detected', 'command', 'lint'],
        'automode'
      );
    }
  }

  /**
   * Set up git worktree for isolation
   */
  private async setupWorktree(_sessionId: string): Promise<void> {
    // Save original branch
    try {
      this.originalBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      }).trim();
    } catch {
      throw new Error('Not a git repository');
    }

    // Generate branch name
    this.branchName = `autohand-automode-${Date.now()}`;

    // Create worktree in temp directory
    const tempDir = path.join('/tmp', `autohand-worktree-${crypto.randomBytes(4).toString('hex')}`);
    this.worktreePath = tempDir;

    try {
      // Create new branch and worktree
      execSync(`git worktree add -b ${this.branchName} ${tempDir}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      });

      // Update workspace root for operations
      // Note: Actual implementation would need to update the agent's workspace
    } catch (error) {
      this.worktreePath = null;
      this.branchName = null;
      throw error;
    }
  }

  /**
   * Create a checkpoint (git commit)
   */
  private async createCheckpoint(iteration: number): Promise<void> {
    const workDir = this.worktreePath ?? this.workspaceRoot;

    try {
      // Check if there are changes to commit
      const status = execSync('git status --porcelain', {
        cwd: workDir,
        encoding: 'utf-8',
      }).trim();

      if (!status) {
        return; // No changes to commit
      }

      // Stage all changes
      execSync('git add -A', { cwd: workDir, encoding: 'utf-8' });

      // Create commit
      const message = `automode: checkpoint at iteration ${iteration}`;
      execSync(`git commit -m "${message}"`, { cwd: workDir, encoding: 'utf-8' });

      // Get commit hash
      const hash = execSync('git rev-parse --short HEAD', {
        cwd: workDir,
        encoding: 'utf-8',
      }).trim();

      // Record checkpoint
      await this.state.recordCheckpoint(hash, message);
      this.gitCommits.push({ hash, message });

      console.log(chalk.gray(`   📌 Checkpoint: ${hash}`));

      // Emit checkpoint event
      const currentState = this.state.getState();
      if (currentState) {
        await this.emitHookEvent('automode:checkpoint', {
          automodeSessionId: currentState.sessionId,
          automodeIteration: iteration,
          automodeCheckpointCommit: hash,
        });
      }
    } catch (error) {
      console.log(chalk.gray(`   ⚠ Checkpoint failed: ${error}`));
    }
  }

  /**
   * Merge worktree back to original branch
   */
  private async mergeWorktree(): Promise<void> {
    if (!this.worktreePath || !this.branchName || !this.originalBranch) {
      return;
    }

    try {
      console.log(chalk.cyan(`\n🔀 Merging ${this.branchName} to ${this.originalBranch}...`));

      // Switch back to original branch
      execSync(`git checkout ${this.originalBranch}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      });

      // Merge the automode branch
      execSync(`git merge ${this.branchName} --no-edit`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      });

      console.log(chalk.green(`   ✅ Successfully merged to ${this.originalBranch}`));

      // Clean up worktree
      await this.cleanupWorktree();
    } catch (error) {
      console.log(chalk.yellow(`   ⚠ Merge failed: ${error}`));
      console.log(chalk.gray(`   Worktree preserved at: ${this.worktreePath}`));
    }
  }

  /**
   * Clean up worktree
   */
  private async cleanupWorktree(): Promise<void> {
    if (!this.worktreePath || !this.branchName) return;

    try {
      // Remove worktree
      execSync(`git worktree remove ${this.worktreePath} --force`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      });

      // Delete branch
      execSync(`git branch -d ${this.branchName}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Clean up after auto-mode ends
   */
  private async cleanup(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    this.abortController = null;

    // Generate changelog
    const currentState = this.state.getState();
    if (currentState) {
      try {
        const changelogPath = await generateChangelog(
          this.workspaceRoot,
          currentState,
          this.state.getIterations(),
          this.gitCommits
        );
        console.log(chalk.gray(`\n📝 Changelog saved: ${changelogPath}`));
      } catch (error) {
        console.log(chalk.gray(`   ⚠ Changelog generation failed: ${error}`));
      }
    }

    // Print summary
    this.printSummary();
  }

  /**
   * Print session summary
   */
  private printSummary(): void {
    const state = this.state.getState();
    if (!state) return;

    const durationMs = Date.now() - this.startTime;
    const durationMinutes = Math.round(durationMs / 60000);

    console.log(chalk.cyan('\n📊 Auto-Mode Summary'));
    console.log(chalk.gray(`   Status: ${state.status}`));
    console.log(chalk.gray(`   Iterations: ${state.currentIteration}`));
    console.log(chalk.gray(`   Duration: ${durationMinutes} minutes`));
    console.log(chalk.gray(`   Files created: ${state.filesCreated}`));
    console.log(chalk.gray(`   Files modified: ${state.filesModified}`));
    if (this.totalCost > 0) {
      console.log(chalk.gray(`   Estimated cost: $${this.totalCost.toFixed(2)}`));
    }
    if (state.branch) {
      console.log(chalk.gray(`   Branch: ${state.branch}`));
    }
    console.log('');
  }

  /**
   * Emit a hook event
   */
  private async emitHookEvent(
    event: string,
    context: Record<string, unknown>
  ): Promise<void> {
    this.emit(event, context);

    if (this.hookManager) {
      try {
        await this.hookManager.executeHooks(event as any, context);
      } catch {
        // Ignore hook errors
      }
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Get merged auto-mode options from CLI and config
 */
export function getAutomodeOptions(
  cliOptions: CLIOptions,
  config: LoadedConfig
): AutomodeOptions | null {
  if (!cliOptions.autoMode) {
    return null;
  }

  const configSettings = config.automode ?? {};

  return {
    prompt: cliOptions.autoMode,
    maxIterations: cliOptions.maxIterations ?? configSettings.maxIterations ?? DEFAULTS.maxIterations,
    completionPromise: cliOptions.completionPromise ?? configSettings.completionPromise ?? DEFAULTS.completionPromise,
    useWorktree: cliOptions.noWorktree === true ? false : (configSettings.useWorktree ?? DEFAULTS.useWorktree),
    checkpointInterval: cliOptions.checkpointInterval ?? configSettings.checkpointInterval ?? DEFAULTS.checkpointInterval,
    maxRuntime: cliOptions.maxRuntime ?? configSettings.maxRuntime ?? DEFAULTS.maxRuntime,
    maxCost: cliOptions.maxCost ?? configSettings.maxCost ?? DEFAULTS.maxCost,
    dryRun: cliOptions.dryRun,
  };
}
