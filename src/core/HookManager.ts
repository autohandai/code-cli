/**
 * Hook Manager - Executes lifecycle hooks based on config
 * @license Apache-2.0
 */
import { spawn } from 'node:child_process';
import { minimatch } from 'minimatch';
import type { HooksSettings, HookDefinition, HookEvent, HookFilter, HookResponse } from '../types.js';

/** Context passed to hooks via environment variables and JSON stdin */
export interface HookContext {
  /** Event that triggered the hook */
  event: HookEvent;
  /** Workspace root path */
  workspace: string;
  /** Session ID */
  sessionId?: string;
  /** Tool name (for tool events) */
  tool?: string;
  /** Tool call ID */
  toolCallId?: string;
  /** JSON-encoded tool args */
  args?: Record<string, unknown>;
  /** Tool success status (for post-tool) */
  success?: boolean;
  /** Tool output (for post-tool) */
  output?: string;
  /** Duration in ms (for post-tool, stop, session-end) */
  duration?: number;
  /** File path (for file-modified) */
  path?: string;
  /** Change type (for file-modified) */
  changeType?: 'create' | 'modify' | 'delete';
  /** User instruction (for pre-prompt) */
  instruction?: string;
  /** Mentioned files (for pre-prompt) */
  mentionedFiles?: string[];
  /** Tokens used (for stop) */
  tokensUsed?: number;
  /** Tool calls count (for stop) */
  toolCallsCount?: number;
  /** Error message (for session-error) */
  error?: string;
  /** Error code (for session-error) */
  errorCode?: string;

  // Session hooks
  /** Session type for session-start (startup, resume, clear) */
  sessionType?: 'startup' | 'resume' | 'clear';
  /** Session end reason */
  sessionEndReason?: 'quit' | 'clear' | 'exit' | 'error';

  // Stop hooks
  /** Tool calls in this turn (for stop) */
  toolCallsInTurn?: number;
  /** Turn duration ms (for stop) */
  turnDuration?: number;

  // Subagent hooks
  /** Subagent task ID (for subagent-stop) */
  subagentId?: string;
  /** Subagent name (for subagent-stop) */
  subagentName?: string;
  /** Subagent type (for subagent-stop) */
  subagentType?: string;
  /** Subagent success status (for subagent-stop) */
  subagentSuccess?: boolean;
  /** Subagent error message (for subagent-stop) */
  subagentError?: string;
  /** Subagent duration ms (for subagent-stop) */
  subagentDuration?: number;

  // Permission hooks
  /** Permission type (for permission-request) */
  permissionType?: string;

  // Notification hooks
  /** Notification type (for notification) */
  notificationType?: string;
  /** Notification message (for notification) */
  notificationMessage?: string;

  // Auto-mode hooks
  /** Auto-mode session ID */
  automodeSessionId?: string;
  /** Auto-mode prompt/task */
  automodePrompt?: string;
  /** Auto-mode current iteration */
  automodeIteration?: number;
  /** Auto-mode max iterations */
  automodeMaxIterations?: number;
  /** Auto-mode actions in current iteration */
  automodeActions?: string[];
  /** Auto-mode files created */
  automodeFilesCreated?: number;
  /** Auto-mode files modified */
  automodeFilesModified?: number;
  /** Auto-mode cancel reason */
  automodeCancelReason?: string;
  /** Auto-mode checkpoint commit hash */
  automodeCheckpointCommit?: string;
  /** Auto-mode total cost */
  automodeTotalCost?: number;

  // Multi-directory support
  /** Additional workspace directories (from --add-dir or /add-dir) */
  additionalWorkspaces?: string[];

  // Team hooks
  /** Team name (for team events) */
  teamName?: string;
  /** Teammate name (for teammate events) */
  teammateName?: string;
  /** Teammate agent definition name (for teammate events) */
  teammateAgentName?: string;
  /** Teammate process ID (for teammate events) */
  teammatePid?: number;
  /** Team task ID (for task events) */
  teamTaskId?: string;
  /** Team task owner (for task events) */
  teamTaskOwner?: string;
  /** Team task result (for task-completed) */
  teamTaskResult?: string;
  /** Total team members (for team events) */
  teamMemberCount?: number;
  /** Completed tasks count (for team-shutdown) */
  teamTasksCompleted?: number;
  /** Total tasks count (for team-shutdown) */
  teamTasksTotal?: number;
}

/** Result of hook execution */
export interface HookExecutionResult {
  hook: HookDefinition;
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration: number;
  /** Exit code from the process */
  exitCode?: number;
  /** Whether this was a blocking error (exit code 2) */
  blockingError?: boolean;
  /** Parsed JSON response from stdout (for control flow) */
  response?: HookResponse;
}

/** Options for HookManager constructor */
export interface HookManagerOptions {
  settings?: HooksSettings;
  workspaceRoot: string;
  /** Callback to persist settings to config */
  onPersist?: () => Promise<void>;
  /** Optional logger for hook output */
  onHookOutput?: (result: HookExecutionResult) => void;
}

/** Default timeout for hooks (5 seconds) */
const DEFAULT_HOOK_TIMEOUT = 5000;

export class HookManager {
  private settings: HooksSettings;
  private workspaceRoot: string;
  private onPersist?: () => Promise<void>;
  private onHookOutput?: (result: HookExecutionResult) => void;
  private initialized = false;

  constructor(options: HookManagerOptions) {
    this.settings = options.settings ?? { enabled: true, hooks: [] };
    this.workspaceRoot = options.workspaceRoot;
    this.onPersist = options.onPersist;
    this.onHookOutput = options.onHookOutput;
  }

  /**
   * Initialize hooks - set up default hooks if none exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // If no hooks configured, set up all defaults
    if (!this.settings.hooks || this.settings.hooks.length === 0) {
      await this.installDefaultHooks();
    } else {
      // Merge any missing default hooks with existing ones
      await this.mergeDefaultHooks();
    }

    // Ensure all hook scripts exist
    await this.ensureHookScripts();
  }

  /**
   * Install default hooks (disabled by default)
   */
  private async installDefaultHooks(): Promise<void> {
    try {
      const { DEFAULT_HOOKS, SMART_COMMIT_HOOK } = await import('./defaultHooks.js');
      this.settings.hooks = [...DEFAULT_HOOKS, SMART_COMMIT_HOOK];
      if (this.onPersist) {
        await this.onPersist();
      }
    } catch {
      // Ignore errors - defaults are optional
    }
  }

  /**
   * Get a unique identifier for a hook (used for deduplication)
   * Uses script filename for script-based hooks, or event+description for inline commands
   */
  private getHookIdentifier(hook: HookDefinition): string {
    // For script-based hooks, use the script filename
    const scriptMatch = hook.command.match(/([^/]+\.sh)$/);
    if (scriptMatch) {
      return `script:${scriptMatch[1]}`;
    }
    // For inline commands, use event + description (if available) or command hash
    if (hook.description) {
      return `${hook.event}:${hook.description}`;
    }
    return `${hook.event}:${hook.command}`;
  }

  /**
   * Merge any missing default hooks with existing user hooks
   * This ensures new built-in hooks are added when upgrading
   */
  private async mergeDefaultHooks(): Promise<void> {
    try {
      const { DEFAULT_HOOKS, SMART_COMMIT_HOOK } = await import('./defaultHooks.js');
      const allDefaults = [...DEFAULT_HOOKS, SMART_COMMIT_HOOK];
      const existingHooks = this.settings.hooks ?? [];

      // Find hooks that don't exist yet (using stable identifiers)
      const existingIds = new Set(existingHooks.map(h => this.getHookIdentifier(h)));
      const missingHooks = allDefaults.filter(h => !existingIds.has(this.getHookIdentifier(h)));

      if (missingHooks.length > 0) {
        // Add missing hooks (disabled by default)
        this.settings.hooks = [...existingHooks, ...missingHooks];
        if (this.onPersist) {
          await this.onPersist();
        }
      }
    } catch (error) {
      // Log error for debugging but don't fail
      console.error('[hooks] Failed to merge default hooks:', error);
    }
  }

  /**
   * Ensure all hook scripts exist in ~/.autohand/hooks/
   * Installs bundled scripts for built-in hooks
   * On Windows, also creates PowerShell (.ps1) versions
   */
  private async ensureHookScripts(): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('path');
      const os = await import('os');

      const hooksDir = path.join(os.homedir(), '.autohand', 'hooks');
      const isWindows = os.platform() === 'win32';

      // Create hooks directory if needed
      await fs.ensureDir(hooksDir);

      // Import all hook scripts (bash versions)
      const { HOOK_SCRIPTS, HOOK_SCRIPTS_WINDOWS } = await import('./defaultHooks.js');

      // Install bash scripts (for Mac/Linux, and WSL on Windows)
      for (const [scriptName, scriptContent] of Object.entries(HOOK_SCRIPTS)) {
        const scriptPath = path.join(hooksDir, scriptName);

        // Only create if doesn't exist (don't overwrite user modifications)
        if (!await fs.pathExists(scriptPath)) {
          await fs.writeFile(scriptPath, scriptContent as string, { mode: 0o755 });
        }
      }

      // On Windows, also install PowerShell versions
      if (isWindows && HOOK_SCRIPTS_WINDOWS) {
        for (const [scriptName, scriptContent] of Object.entries(HOOK_SCRIPTS_WINDOWS)) {
          const scriptPath = path.join(hooksDir, scriptName);

          if (!await fs.pathExists(scriptPath)) {
            await fs.writeFile(scriptPath, scriptContent as string);
          }
        }
      }
    } catch (error) {
      // Log error for debugging but don't fail initialization
      // This is non-critical - hooks will still work with inline commands
      if (process.env.DEBUG || process.env.AUTOHAND_DEBUG) {
        console.error('[hooks] Failed to install hook scripts:', error);
      }
    }
  }

  /**
   * Check if hooks are globally enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled !== false;
  }

  /**
   * Get all registered hooks
   */
  getHooks(): HookDefinition[] {
    return this.settings.hooks ?? [];
  }

  /**
   * Get current settings
   */
  getSettings(): HooksSettings {
    return { ...this.settings };
  }

  /**
   * Update settings
   */
  async updateSettings(settings: Partial<HooksSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    if (this.onPersist) {
      await this.onPersist();
    }
  }

  /**
   * Add a new hook
   */
  async addHook(hook: HookDefinition): Promise<void> {
    const hooks = this.settings.hooks ?? [];
    hooks.push({ ...hook, enabled: hook.enabled !== false });
    this.settings.hooks = hooks;
    if (this.onPersist) {
      await this.onPersist();
    }
  }

  /**
   * Remove a hook by index within its event type
   */
  async removeHook(event: HookEvent, index: number): Promise<boolean> {
    const hooks = this.settings.hooks ?? [];
    const eventHooks = hooks.filter(h => h.event === event);

    if (index < 0 || index >= eventHooks.length) {
      return false;
    }

    const hookToRemove = eventHooks[index];
    const globalIndex = hooks.indexOf(hookToRemove);

    if (globalIndex !== -1) {
      hooks.splice(globalIndex, 1);
      this.settings.hooks = hooks;
      if (this.onPersist) {
        await this.onPersist();
      }
      return true;
    }
    return false;
  }

  /**
   * Toggle a hook's enabled status
   */
  async toggleHook(event: HookEvent, index: number): Promise<boolean> {
    const hooks = this.settings.hooks ?? [];
    const eventHooks = hooks.filter(h => h.event === event);

    if (index < 0 || index >= eventHooks.length) {
      return false;
    }

    const hook = eventHooks[index];
    hook.enabled = hook.enabled === false;

    if (this.onPersist) {
      await this.onPersist();
    }
    return true;
  }

  /**
   * Check if a hook's filter matches the context
   */
  private matchesFilter(filter: HookFilter | undefined, context: HookContext): boolean {
    if (!filter) return true;

    // Check tool filter
    if (filter.tool && filter.tool.length > 0) {
      if (!context.tool || !filter.tool.includes(context.tool)) {
        return false;
      }
    }

    // Check path filter (glob patterns)
    if (filter.path && filter.path.length > 0) {
      if (!context.path) return false;
      const matches = filter.path.some(pattern => minimatch(context.path!, pattern));
      if (!matches) return false;
    }

    return true;
  }

  /**
   * Check if a hook's regex matcher matches the context
   * Matchers apply to tool names, notification types, session types, etc.
   */
  private matchesMatcher(hook: HookDefinition, context: HookContext): boolean {
    if (!hook.matcher) return true;

    // Determine what value to match based on event type
    let value = '';
    switch (hook.event) {
      case 'pre-tool':
      case 'post-tool':
      case 'permission-request':
        value = context.tool ?? '';
        break;
      case 'notification':
        value = context.notificationType ?? '';
        break;
      case 'session-start':
        value = context.sessionType ?? '';
        break;
      case 'session-end':
        value = context.sessionEndReason ?? '';
        break;
      case 'subagent-stop':
        value = context.subagentType ?? '';
        break;
      default:
        return true; // No matcher for other events
    }

    try {
      return new RegExp(hook.matcher).test(value);
    } catch {
      // Invalid regex - don't match
      return false;
    }
  }

  /**
   * Build environment variables from hook context
   */
  private buildEnvironment(context: HookContext): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      HOOK_EVENT: context.event,
      HOOK_WORKSPACE: context.workspace,
    };

    // Session info
    if (context.sessionId) env.HOOK_SESSION_ID = context.sessionId;

    // Tool hooks
    if (context.tool) env.HOOK_TOOL = context.tool;
    if (context.toolCallId) env.HOOK_TOOL_CALL_ID = context.toolCallId;
    if (context.args) env.HOOK_ARGS = JSON.stringify(context.args);
    if (context.success !== undefined) env.HOOK_SUCCESS = String(context.success);
    if (context.output) env.HOOK_OUTPUT = context.output;
    if (context.duration !== undefined) env.HOOK_DURATION = String(context.duration);

    // File hooks
    if (context.path) env.HOOK_PATH = context.path;
    if (context.changeType) env.HOOK_CHANGE_TYPE = context.changeType;

    // Prompt hooks
    if (context.instruction) env.HOOK_INSTRUCTION = context.instruction;
    if (context.mentionedFiles) env.HOOK_MENTIONED_FILES = JSON.stringify(context.mentionedFiles);

    // Stop/response hooks
    if (context.tokensUsed !== undefined) env.HOOK_TOKENS = String(context.tokensUsed);
    if (context.toolCallsCount !== undefined) env.HOOK_TOOL_CALLS_COUNT = String(context.toolCallsCount);
    if (context.toolCallsInTurn !== undefined) env.HOOK_TURN_TOOL_CALLS = String(context.toolCallsInTurn);
    if (context.turnDuration !== undefined) env.HOOK_TURN_DURATION = String(context.turnDuration);

    // Error hooks
    if (context.error) env.HOOK_ERROR = context.error;
    if (context.errorCode) env.HOOK_ERROR_CODE = context.errorCode;

    // Session start/end hooks
    if (context.sessionType) env.HOOK_SESSION_TYPE = context.sessionType;
    if (context.sessionEndReason) env.HOOK_SESSION_END_REASON = context.sessionEndReason;

    // Subagent hooks
    if (context.subagentId) env.HOOK_SUBAGENT_ID = context.subagentId;
    if (context.subagentType) env.HOOK_SUBAGENT_TYPE = context.subagentType;

    // Permission hooks
    if (context.permissionType) env.HOOK_PERMISSION_TYPE = context.permissionType;

    // Notification hooks
    if (context.notificationType) env.HOOK_NOTIFICATION_TYPE = context.notificationType;
    if (context.notificationMessage) env.HOOK_NOTIFICATION_MSG = context.notificationMessage;

    // Auto-mode hooks
    if (context.automodeSessionId) env.HOOK_AUTOMODE_SESSION_ID = context.automodeSessionId;
    if (context.automodePrompt) env.HOOK_AUTOMODE_PROMPT = context.automodePrompt;
    if (context.automodeIteration !== undefined) env.HOOK_AUTOMODE_ITERATION = String(context.automodeIteration);
    if (context.automodeMaxIterations !== undefined) env.HOOK_AUTOMODE_MAX_ITERATIONS = String(context.automodeMaxIterations);
    if (context.automodeActions) env.HOOK_AUTOMODE_ACTIONS = JSON.stringify(context.automodeActions);
    if (context.automodeFilesCreated !== undefined) env.HOOK_AUTOMODE_FILES_CREATED = String(context.automodeFilesCreated);
    if (context.automodeFilesModified !== undefined) env.HOOK_AUTOMODE_FILES_MODIFIED = String(context.automodeFilesModified);
    if (context.automodeCancelReason) env.HOOK_AUTOMODE_CANCEL_REASON = context.automodeCancelReason;
    if (context.automodeCheckpointCommit) env.HOOK_AUTOMODE_CHECKPOINT = context.automodeCheckpointCommit;
    if (context.automodeTotalCost !== undefined) env.HOOK_AUTOMODE_COST = String(context.automodeTotalCost);

    // Multi-directory support
    if (context.additionalWorkspaces && context.additionalWorkspaces.length > 0) {
      env.HOOK_ADDITIONAL_WORKSPACES = JSON.stringify(context.additionalWorkspaces);
    }

    return env as Record<string, string>;
  }

  /**
   * Build JSON input to pass via stdin to hook
   */
  private buildJsonInput(context: HookContext): string {
    return JSON.stringify({
      session_id: context.sessionId,
      cwd: context.workspace,
      hook_event_name: context.event,
      // Tool context
      tool_name: context.tool,
      tool_input: context.args,
      tool_use_id: context.toolCallId,
      tool_response: context.output,
      tool_success: context.success,
      // File context
      file_path: context.path,
      change_type: context.changeType,
      // Prompt context
      instruction: context.instruction,
      mentioned_files: context.mentionedFiles,
      // Stop/response context
      tokens_used: context.tokensUsed,
      tool_calls_count: context.toolCallsCount,
      turn_tool_calls: context.toolCallsInTurn,
      turn_duration: context.turnDuration,
      duration: context.duration,
      // Error context
      error: context.error,
      error_code: context.errorCode,
      // Session context
      session_type: context.sessionType,
      session_end_reason: context.sessionEndReason,
      // Subagent context
      subagent_id: context.subagentId,
      subagent_name: context.subagentName,
      subagent_type: context.subagentType,
      subagent_success: context.subagentSuccess,
      subagent_error: context.subagentError,
      subagent_duration: context.subagentDuration,
      // Permission context
      permission_type: context.permissionType,
      // Notification context
      notification_type: context.notificationType,
      notification_message: context.notificationMessage,
      // Auto-mode context
      automode_session_id: context.automodeSessionId,
      automode_prompt: context.automodePrompt,
      automode_iteration: context.automodeIteration,
      automode_max_iterations: context.automodeMaxIterations,
      automode_actions: context.automodeActions,
      automode_files_created: context.automodeFilesCreated,
      automode_files_modified: context.automodeFilesModified,
      automode_cancel_reason: context.automodeCancelReason,
      automode_checkpoint_commit: context.automodeCheckpointCommit,
      automode_total_cost: context.automodeTotalCost,
      // Multi-directory support
      additional_workspaces: context.additionalWorkspaces,
    });
  }

  /**
   * Parse JSON response from hook stdout
   */
  private parseHookResponse(stdout: string): HookResponse | undefined {
    const trimmed = stdout.trim();
    if (!trimmed.startsWith('{')) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed) as HookResponse;
    } catch {
      // Not valid JSON - ignore
      return undefined;
    }
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: HookDefinition, context: HookContext): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT;
    const env = this.buildEnvironment(context);
    const jsonInput = this.buildJsonInput(context);

    return new Promise((resolve) => {
      const child = spawn(hook.command, [], {
        shell: true,
        cwd: this.workspaceRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin enabled for JSON input
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Force kill after 1 second if still running
        setTimeout(() => child.kill('SIGKILL'), 1000);
      }, timeout);

      // Write JSON context to stdin
      child.stdin?.write(jsonInput);
      child.stdin?.end();

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        const exitCode = code ?? 0;

        // Exit code 2 = blocking error (special handling)
        const isBlockingError = exitCode === 2;

        // Parse JSON response if exit code is 0 and stdout looks like JSON
        let response: HookResponse | undefined;
        if (exitCode === 0) {
          response = this.parseHookResponse(stdout);
        }

        const result: HookExecutionResult = {
          hook,
          success: !killed && exitCode === 0,
          stdout: stdout.trim() || undefined,
          stderr: stderr.trim() || undefined,
          error: killed
            ? `Hook timed out after ${timeout}ms`
            : isBlockingError
              ? stderr.trim() || 'Hook blocked execution'
              : undefined,
          duration,
          exitCode,
          blockingError: isBlockingError,
          response,
        };

        if (this.onHookOutput) {
          this.onHookOutput(result);
        }

        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        const result: HookExecutionResult = {
          hook,
          success: false,
          error: err.message,
          duration,
          exitCode: -1,
        };

        if (this.onHookOutput) {
          this.onHookOutput(result);
        }

        resolve(result);
      });
    });
  }

  /**
   * Get hooks for an event, including alias handling
   */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    const hooks = this.getHooks().filter(h => h.enabled !== false);

    // Handle 'stop' and 'post-response' as aliases (backward compatibility)
    if (event === 'stop') {
      return hooks.filter(h => h.event === 'stop' || h.event === 'post-response');
    }
    if (event === 'post-response') {
      return hooks.filter(h => h.event === 'stop' || h.event === 'post-response');
    }

    return hooks.filter(h => h.event === event);
  }

  /**
   * Execute all hooks for an event
   *
   * Sync hooks are executed sequentially and block until complete.
   * Async hooks are executed in parallel and don't block.
   */
  async executeHooks(event: HookEvent, context: Omit<HookContext, 'event' | 'workspace'>): Promise<HookExecutionResult[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const fullContext: HookContext = {
      ...context,
      event,
      workspace: this.workspaceRoot,
    };

    // Get hooks for event, then filter by both filter and matcher
    const hooks = this.getHooksForEvent(event).filter(h =>
      this.matchesFilter(h.filter, fullContext) && this.matchesMatcher(h, fullContext)
    );

    if (hooks.length === 0) {
      return [];
    }

    const syncHooks = hooks.filter(h => !h.async);
    const asyncHooks = hooks.filter(h => h.async);
    const results: HookExecutionResult[] = [];

    // Execute sync hooks sequentially
    for (const hook of syncHooks) {
      const result = await this.executeHook(hook, fullContext);
      results.push(result);

      // If hook returned continue: false, stop processing
      if (result.response?.continue === false) {
        break;
      }
    }

    // Execute async hooks in parallel (fire and forget, but still collect results)
    if (asyncHooks.length > 0) {
      const asyncResults = await Promise.all(
        asyncHooks.map(hook => this.executeHook(hook, fullContext))
      );
      results.push(...asyncResults);
    }

    return results;
  }

  /**
   * Test a hook by executing it with a sample context
   */
  async testHook(hook: HookDefinition): Promise<HookExecutionResult> {
    const context: HookContext = {
      event: hook.event,
      workspace: this.workspaceRoot,
      tool: 'test_tool',
      toolCallId: 'test_123',
      args: { test: true },
      success: true,
      path: 'test/file.ts',
      changeType: 'modify',
      instruction: 'Test instruction',
      tokensUsed: 100,
    };

    return this.executeHook(hook, context);
  }

  /**
   * Get a summary of hooks by event
   */
  getSummary(): Record<HookEvent, { total: number; enabled: number }> {
    const events: HookEvent[] = [
      'pre-tool',
      'post-tool',
      'file-modified',
      'pre-prompt',
      'stop',
      'post-response', // Alias for 'stop'
      'session-error',
      'subagent-stop',
      'session-start',
      'session-end',
      'permission-request',
      'notification',
      // Auto-mode events
      'automode:start',
      'automode:iteration',
      'automode:checkpoint',
      'automode:pause',
      'automode:resume',
      'automode:cancel',
      'automode:complete',
      'automode:error',
    ];
    const summary: Record<HookEvent, { total: number; enabled: number }> = {} as Record<HookEvent, { total: number; enabled: number }>;

    for (const event of events) {
      const eventHooks = this.getHooks().filter(h => h.event === event);
      summary[event] = {
        total: eventHooks.length,
        enabled: eventHooks.filter(h => h.enabled !== false).length,
      };
    }

    return summary;
  }
}
