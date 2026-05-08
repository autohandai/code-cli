/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProviderConfig } from '../../config.js';
import { AUTH_CONFIG } from '../../constants.js';
import type { LLMToolCall } from '../../types.js';
import { renderTerminalMarkdown } from '../immediateCommandRouter.js';
import { isLikelyFilePathSlashInput } from '../slashInputDetection.js';
import { isShellCommand, parseShellCommand } from '../../ui/shellCommand.js';
import { plan as planCommand } from '../../commands/plan.js';
import { runWithConcurrency } from '../../utils/parallel.js';
import { buildSessionChatLog } from '../../session/chatLog.js';
import { formatExitCleanup, formatForceExit } from '../../ui/theme/startup.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';

const execFileAsync = promisify(execFile);

export interface AgentLifecycleHost {
  [key: string]: any;
}

export async function runAgentInteractive(host: AgentLifecycleHost, initialInstruction?: string): Promise<void> {
    // Bail out early if stdin is not a TTY - interactive mode requires a terminal
    if (!process.stdin.isTTY) {
      console.error(chalk.red('Interactive mode requires a terminal (TTY). Use --prompt for non-interactive usage.'));
      process.exitCode = 1;
      return;
    }

    // Queue piped text so the first loop iteration processes it before prompting.
    if (initialInstruction) {
      host.pendingInkInstructions.push(initialInstruction);
    }

    host.mcpStartupCoordinator.prepareForInteractiveStartup();

    // Start ALL initialization in background so prompt appears instantly.
    // The user can start typing while managers initialize.
    // When they submit, we await initReady before processing.
    host.initReady = host.performBackgroundInit();

    // Fire startup suggestion LLM call immediately so the first prompt
    // shows contextual ghost text. Git context is gathered asynchronously
    // and the LLM call runs fully in the background.
    // promptForInstruction() awaits this work with a startup deadline,
    // then falls back to no suggestion if the call hasn't resolved.
    if (host.suggestionEngine) {
      const engine = host.suggestionEngine;
      const workspaceRoot = host.runtime.workspaceRoot;
      const collector = host.workspaceFileCollector;
      host.isStartupSuggestion = true;
      host.pendingSuggestion = (async () => {
        const [gitStatusResult, gitLogResult] = await runWithConcurrency([
          {
            label: 'git_status',
            run: async () => execFileAsync('git', ['status', '-sb'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
          {
            label: 'git_log',
            run: async () => execFileAsync('git', ['log', '--oneline', '-5'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
        ], host.getParallelismLimit());
        const recentFiles = collector.getCachedFiles().slice(0, 20);
        await engine.generateFromProjectContext({
          gitStatus: gitStatusResult?.stdout.trim() || undefined,
          recentCommits: gitLogResult?.stdout.trim() || undefined,
          recentFiles,
        });
      })();
      host.persistentInput.setPendingSuggestion(host.pendingSuggestion);
      host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion);
    }

    // Install exit signal handlers to stop queue processing immediately on SIGINT/SIGTERM
    host.installExitSignalHandlers();

    // Show prompt immediately - don't wait for init
    await host.runInteractiveLoop();

    // Clean up signal handlers
    host.removeExitSignalHandlers();
  }

export function installAgentExitSignalHandlers(host: AgentLifecycleHost): void {
    if (host.exitSignalHandlersInstalled) return;
    host.exitSignalHandlersInstalled = true;

    const handleExitSignal = () => {
      if (host.shouldExit) {
        // Second signal - force immediate exit
        console.log(formatForceExit());
        process.exit(0);
      }
      host.shouldExit = true;
      console.log(formatExitCleanup());
      host.clearAllQueuesAndAbort();
    };

    process.on('SIGINT', handleExitSignal);
    process.on('SIGTERM', handleExitSignal);
  }

export function removeAgentExitSignalHandlers(host: AgentLifecycleHost): void {
    host.exitSignalHandlersInstalled = false;
    // Note: process.removeListener would require storing the handler reference.
    // The shouldExit flag prevents handlers from doing anything after cleanup.
  }

export function clearAgentQueuesAndAbort(host: AgentLifecycleHost): void {
    // Clear pending instruction queues
    host.pendingInkInstructions.length = 0;
    if (host.inkRenderer) {
      host.inkRenderer.clearQueue();
    }
    // Clear persistent input queue
    while (host.persistentInput.hasQueued()) {
      host.persistentInput.dequeue();
    }

    // Abort any active abort controllers to stop current work
    if (host.activeAbortController) {
      try {
        host.activeAbortController.abort();
      } catch {
        // Ignore abort errors
      }
      host.activeAbortController = null;
    }
    if (host.currentInkAbortController) {
      try {
        host.currentInkAbortController.abort();
      } catch {
        // Ignore abort errors
      }
      host.currentInkAbortController = null;
    }
    host.shellSuggestionProvider?.abort();

    // Stop any active team processes
    if (host.teamManager) {
      host.teamManager.shutdown().catch(() => {});
    }

    // Resolve any pending ink instruction resolver to unblock the loop
    if (host.inkInstructionResolver) {
      host.inkInstructionResolver();
      host.inkInstructionResolver = null;
    }
  }

export async function initializeAgentManagers(host: AgentLifecycleHost): Promise<void> {
    await runWithConcurrency([
      { label: 'session_manager', run: async () => host.sessionManager.initialize() },
      { label: 'project_manager', run: async () => host.projectManager.initialize() },
      { label: 'memory_manager', run: async () => host.memoryManager.initialize() },
      { label: 'skills_registry', run: async () => host.skillsRegistry.initialize() },
      { label: 'hook_manager', run: async () => host.hookManager.initialize() },
      {
        label: 'workspace_files',
        run: async () => {
          await host.workspaceFileCollector.collectWorkspaceFiles();
        },
      },
    ], host.getParallelismLimit());
  }

export async function performAgentBackgroundInit(host: AgentLifecycleHost): Promise<void> {
    try {
      // Phase 1: Parallel manager initialization
      await host.initializeManagers();

      // Fire MCP connections in background (non-blocking, like Claude Code).
      // Servers connect asynchronously; tools become available once ready.
      // Does NOT block the main init pipeline or user prompt.
      if (host.runtime.config.mcp?.enabled !== false) {
        host.mcpStartupCoordinator.markConnectStarted();
        host.mcpReady = host.mcpManager
          .connectAll(host.runtime.config.mcp?.servers ?? [])
          .then(() => { host.syncMcpTools(); })
          .catch(() => { /* individual server errors already captured by connectAll */ })
          .finally(() => {
            host.mcpStartupCoordinator.markSummaryPending();
          });
      }

      // Phase 2: Sequential setup that depends on phase 1

      await host.skillsRegistry.setWorkspace(host.runtime.workspaceRoot);
      host.feedbackManager.startSession();
      const providerSettings = getProviderConfig(host.runtime.config, host.activeProvider);
      const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      const [, session] = await Promise.all([
        host.resetConversationContext(),
        host.sessionManager.createSession(host.runtime.workspaceRoot, model),
      ]);

      // Inject explicit session bootstrap so the LLM is consciously aware of
      // memories, AGENTS.md, skills, and project context from the first turn.
      await host.injectSessionBootstrap();

      // Phase 3: Telemetry (no stdout output)
      if (session) {
        await host.telemetryManager.startSession(
          session.metadata.sessionId,
          model,
          host.activeProvider
        );
      }

      // NOTE: session-start hook is fired in ensureInitComplete() AFTER the
      // prompt closes, so its output doesn't corrupt the readline display.
    } finally {
      host.initDone = true;
    }
  }

export async function ensureAgentInitComplete(host: AgentLifecycleHost): Promise<void> {
    if (host.initReady) {
      await host.initReady;
      host.initReady = null;

      // Keep MCP startup async and do not block first instruction execution.
      // MCP tool calls still await mcpReady in the tool executor path.
      host.flushMcpStartupSummaryIfPending();

      // Fire session-start hook now that the prompt is closed and stdout is clean
      const session = host.sessionManager.getCurrentSession();
      await host.hookManager.executeHooks('session-start', {
        sessionId: session?.metadata.sessionId,
        sessionType: 'startup',
      });
    }
  }

export async function initializeAgentForRPC(host: AgentLifecycleHost): Promise<void> {
    // Initialize managers in parallel for faster startup
    await host.initializeManagers();
    // Fire MCP connections in background (non-blocking)
    if (host.runtime.config.mcp?.enabled !== false) {
      host.mcpReady = host.mcpManager
        .connectAll(host.runtime.config.mcp?.servers ?? [])
        .then(() => { host.syncMcpTools(); })
        .catch(() => {})
        .finally(() => {
          host.mcpStartupCoordinator.markSummaryPending();
        });
    }
    // These must run sequentially after the parallel init
    await host.skillsRegistry.setWorkspace(host.runtime.workspaceRoot);
    const providerSettings = getProviderConfig(host.runtime.config, host.activeProvider);
    const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    const [, session] = await Promise.all([
      host.resetConversationContext(),
      host.sessionManager.createSession(host.runtime.workspaceRoot, model),
    ]);

    await host.injectSessionBootstrap();

    // Start telemetry session
    if (session) {
      await host.telemetryManager.startSession(
        session.metadata.sessionId,
        model,
        host.activeProvider
      );
    }

    // Fire session-start hook
    await host.hookManager.executeHooks('session-start', {
      sessionId: session?.metadata.sessionId,
      sessionType: 'startup',
    });
  }

export async function runAgentCommandMode(host: AgentLifecycleHost, instruction: string): Promise<void> {
    const previousCommandMode = host.runtime.isCommandMode;
    const previousUseInkRenderer = host.useInkRenderer;
    host.runtime.isCommandMode = true;
    host.useInkRenderer = false;

    try {
      await host.initializeForRPC();

      const turnStartTime = Date.now();
      await host.runInstruction(instruction);

      // Fire stop hook after turn completes (non-blocking)
      const turnDuration = Date.now() - turnStartTime;
      const session = host.sessionManager.getCurrentSession();
      const snapshot = host.getStatusSnapshot();
      host.hookManager.executeHooks('stop', {
        sessionId: session?.metadata.sessionId,
        turnDuration,
        tokensUsed: snapshot.tokensUsed,
        tokensUsageStatus: snapshot.tokensUsageStatus,
      }).catch(() => {
        // Ignore hook errors - they shouldn't block the user
      });

      // Restore stdin to known state after hook execution
      host.ensureStdinReady();

      // Ring terminal bell to notify user (shows badge on terminal tab)
      if (host.runtime.config.ui?.terminalBell !== false) {
        process.stdout.write('\x07');
      }

      // Native OS notification for task completion
      if (host.runtime.config.ui?.showCompletionNotification !== false) {
        host.notificationService.notify(
          { body: host.getCompletionNotificationBody(), reason: 'task_complete' },
          host.getNotificationGuards()
        ).catch(() => {});
      }

      if (host.runtime.options.autoCommit) {
        await host.performAutoCommit();
      }

      // Fire session-end hook for command mode
      await host.hookManager.executeHooks('session-end', {
        sessionId: session?.metadata.sessionId,
        sessionEndReason: 'exit',
        duration: Date.now() - host.sessionStartedAt,
      });

      // Restore stdin after session-end hook
      host.ensureStdinReady();

      await host.telemetryManager.endSession('completed');
    } finally {
      host.runtime.isCommandMode = previousCommandMode;
      host.useInkRenderer = previousUseInkRenderer;
    }
  }

export async function restoreAgentSessionState(host: AgentLifecycleHost, sessionId: string) {
    const session = await host.sessionManager.loadSession(sessionId);

    await host.resetConversationContext();
    await host.injectSessionBootstrap();
    const messages = session.getMessages();
    host.restoredChatMessages = buildSessionChatLog(messages);
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!msg.content.startsWith('You are Autohand')) {
          host.conversation.addSystemNote(msg.content);
        }
      } else {
        let convertedToolCalls: LLMToolCall[] | undefined;
        const sessionToolCalls = (msg as any).toolCalls;
        if (sessionToolCalls && Array.isArray(sessionToolCalls)) {
          convertedToolCalls = sessionToolCalls.map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.tool || tc.function?.name || 'unknown',
              arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {})
            }
          }));
        }

        host.conversation.addMessage({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          tool_calls: convertedToolCalls,
          tool_call_id: (msg as any).tool_call_id
        });
      }
    }

    await host.injectProjectKnowledge();
    host.updateContextUsage(host.conversation.history());
    if (host.inkRenderer?.setChatMessages) {
      host.inkRenderer.setChatMessages(host.restoredChatMessages);
    }
    return session;
  }

export async function attachAgentSession(
  host: AgentLifecycleHost,
  sessionId: string
): Promise<{ sessionId: string; model: string; workspaceRoot: string; messageCount: number }> {
    await host.initializeManagers();
    const session = await host.restoreSessionState(sessionId);

    await host.telemetryManager.startSession(
      sessionId,
      session.metadata.model,
      host.activeProvider
    );

    return {
      sessionId: session.metadata.sessionId,
      model: session.metadata.model,
      workspaceRoot: session.metadata.projectPath,
      messageCount: session.getMessages().length,
    };
  }

export async function resumeAgentSession(host: AgentLifecycleHost, sessionId: string): Promise<void> {
    // Initialize managers and pre-load files in parallel
    await host.initializeManagers();

    try {
      const session = await host.restoreSessionState(sessionId);

      console.log(chalk.cyan(`\n📂 Resumed session ${sessionId}`));

      // Start telemetry for resumed session
      await host.telemetryManager.startSession(
        sessionId,
        session.metadata.model,
        host.activeProvider
      );

      // Start interactive loop
      await host.runInteractiveLoop();
    } catch (error) {
      console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
      await host.telemetryManager.trackError({
        type: 'session_resume_failed',
        message: (error as Error).message,
        context: 'resumeSession'
      });
      // Fallback to new session
      const providerSettings = getProviderConfig(host.runtime.config, host.activeProvider);
      const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      await host.sessionManager.createSession(host.runtime.workspaceRoot, model);
      await host.runInteractiveLoop();
    }
  }

export function logAgentQueuedProcessingMessage(host: AgentLifecycleHost, instruction: string, remaining = 0): void {
    void host;
    void instruction;
    void remaining;
  }

export async function runAgentInteractiveLoop(host: AgentLifecycleHost): Promise<void> {
    // Initialize Ink UI early so the composer is ready before the first idle check.
    // This ensures consistent UI from startup instead of falling back to readline
    // and then switching to Ink after the first prompt.
    if (host.useInkRenderer && !host.inkRenderer) {
      await host.initializeUI(undefined, undefined, true);
      if (host.restoredChatMessages?.length && host.inkRenderer?.setChatMessages) {
        host.inkRenderer.setChatMessages(host.restoredChatMessages);
        host.restoredChatMessages = [];
      }
      // Set to idle state so the Composer accepts input immediately
      host.setComposerIdle();
      host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion ?? undefined);
    }

    while (true) {
      // Check if we should exit immediately (SIGINT/SIGTERM received)
      if (host.shouldExit) {
        return;
      }

      try {
        let instruction: string | null = null;

        // Check shouldExit again before processing any queued items
        if (host.shouldExit) {
          return;
        }

        if (host.pendingInkInstructions.length > 0) {
          instruction = host.pendingInkInstructions.shift() ?? null;
          if (instruction) {
            if (host.runtime.spinner?.isSpinning) {
              host.runtime.spinner.stop();
              host.lastRenderedStatus = '';
            }
            const remaining = host.pendingInkInstructions.length;
            host.logQueuedProcessingMessage(instruction, remaining);
          }
        } else if (host.inkRenderer?.hasQueuedInstructions()) {
          instruction = host.inkRenderer.dequeueInstruction() ?? null;
          if (instruction) {
            if (host.runtime.spinner?.isSpinning) {
              host.runtime.spinner.stop();
              host.lastRenderedStatus = '';
            }
            const remaining = host.inkRenderer.getQueueCount();
            host.logQueuedProcessingMessage(instruction, remaining);
          }
        } else if (host.persistentInput.hasQueued()) {
          const queued = host.persistentInput.dequeue();
          if (queued) {
            instruction = queued.text;
            if (host.runtime.spinner?.isSpinning) {
              host.runtime.spinner.stop();
              host.lastRenderedStatus = '';
            }
            const remaining = host.persistentInput.hasQueued()
              ? host.persistentInput.getQueueLength()
              : 0;
            host.logQueuedProcessingMessage(instruction, remaining);
          }
        }

        if (!instruction) {
          if (host.persistentInputActiveTurn) {
            host.promptSeedInput = host.persistentInput.getCurrentInput();
            host.persistentInput.stop();
            host.persistentInputActiveTurn = false;
          }
          // If Ink is still active (idle between turns), wait for the next
          // instruction from the Composer instead of stopping the renderer and
          // falling back to readline. This keeps the Composer alive after
          // non-interactive slash commands like /help and /history.
          writeAutohandDebugLine(
            `[DEBUG] Idle check: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
            host.writeDebugLine?.bind(host)
          );
          if (host.inkRenderer?.isRunning()) {
            // Ensure the renderer is in idle (not working) state so the
            // Composer accepts input.
            writeAutohandDebugLine('[DEBUG] Entering idle-wait, setting working=false', host.writeDebugLine?.bind(host));
            host.setComposerIdle();

            // Wait for the user to submit text in the Composer.
            // handleInkSubmittedInstruction resolves host promise when it
            // queues a new instruction.
            writeAutohandDebugLine('[DEBUG] Waiting for resolver...', host.writeDebugLine?.bind(host));
            await new Promise<void>(resolve => {
              host.inkInstructionResolver = resolve;
            });
            writeAutohandDebugLine('[DEBUG] Resolver resolved', host.writeDebugLine?.bind(host));

            // The instruction is now queued — dequeue it.
            if (host.inkRenderer?.hasQueuedInstructions()) {
              instruction = host.inkRenderer.dequeueInstruction() ?? null;
              writeAutohandDebugLine(`[DEBUG] Dequeued instruction: ${instruction}`, host.writeDebugLine?.bind(host));
            }
            // If we still don't have an instruction (race condition), loop
            // around and try again.
            if (!instruction) {
              writeAutohandDebugLine('[DEBUG] No instruction after resolver, continuing', host.writeDebugLine?.bind(host));
              continue;
            }
          } else {
            // Ink is not running — drain any stale queued instructions and
            // fall back to readline.
            writeAutohandDebugLine('[DEBUG] Ink not running, falling back to readline', host.writeDebugLine?.bind(host));
            if (host.inkRenderer) {
              while (host.inkRenderer.hasQueuedInstructions()) {
                const qi = host.inkRenderer.dequeueInstruction();
                if (qi) host.pendingInkInstructions.push(qi);
              }
              writeAutohandDebugLine('[DEBUG] Stopping inkRenderer in fallback path', host.writeDebugLine?.bind(host));
              host.inkRenderer.stop();
              host.inkRenderer = null;
              host.runtime.inkRenderer = undefined;
              host.inkInstructionResolver = null;
            }
            writeAutohandDebugLine('[DEBUG] Calling promptForInstruction in readline mode', host.writeDebugLine?.bind(host));
            instruction = await host.promptForInstruction();
            writeAutohandDebugLine(`[DEBUG] promptForInstruction returned: ${instruction}`, host.writeDebugLine?.bind(host));
          }
        }

        if (!instruction) {
          continue;
        }

        // Handle ! shell commands locally (never send to LLM)
        if (isShellCommand(instruction)) {
          const shellCmd = parseShellCommand(instruction);
          await host.executeImmediateShellCommand(shellCmd);
          continue;
        }

        // Handle slash commands locally (never send to LLM).
        // The readline path (promptForInstruction) handles slash commands
        // before runInstruction, but instructions from the Ink queue bypass
        // that path. Without host, /help etc. go through the full ReAct loop
        // which sends them to the LLM and leaves the composer frozen.
        if (instruction.startsWith('/')) {
          const parsed = host.parseSlashCommand(instruction);
          const isKnownSlashCommand = host.isSlashCommandSupported(parsed.command);
          if (isKnownSlashCommand || !isLikelyFilePathSlashInput(instruction)) {
            const command = parsed.command;
            const args = parsed.args;

            // /quit and /exit are handled above (line 1795)
            if (command !== '/quit' && command !== '/exit') {
              const isInkRunning = host.inkRenderer?.isRunning();

              // Echo the slash command to the chat log so it's visible.
              // In Ink mode this must stay inside the renderer; raw stdout
              // fights the composer and duplicates the input frame.
              if (isInkRunning) {
                host.inkRenderer.addUserMessage(instruction);
              } else if (command !== '/plan') {
                console.log(chalk.white(`\n› ${instruction}`));
              }

              writeAutohandDebugLine(
                `[DEBUG] Before runSlashCommandWithInput: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );

              // For /plan in Ink mode, redirect console output to user messages
              // to avoid stdout corruption that freezes the composer.
              let handled: string | null = null;
              if (command === '/plan' && host.inkRenderer?.isRunning()) {
                const logBuffer: string[] = [];
                handled = await planCommand({} as any, args.join(' '), {
                  output: (msg: string) => logBuffer.push(msg),
                });
                if (logBuffer.length > 0) {
                  host.inkRenderer.addUserMessage(logBuffer.join('\n'));
                }
              } else {
                handled = await host.runSlashCommandWithInput(command, args);
              }

              writeAutohandDebugLine(
                `[DEBUG] After runSlashCommandWithInput: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );
              if (handled !== null && host.inkRenderer?.isRunning()) {
                host.inkRenderer.addAssistantMessage(handled);
              } else if (handled !== null) {
                console.log(renderTerminalMarkdown(handled));
              }
              // Ensure the renderer is in idle state so the Composer accepts input
              // after non-interactive slash commands like /help, /clear, /history
              writeAutohandDebugLine(
                `[DEBUG] After slash command output: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );
              if (host.ui || host.inkRenderer) {
                host.setComposerIdle();
                host.clearComposerInput();
                // Return to the top of the loop so the idle-wait path can await
                // the next Composer submission without falling through to
                // instruction.startsWith('/') which would throw on null.
                continue;
              } else {
                continue;
              }
            }
          }
        }

        // Handle # trigger for storing memories (never send to LLM).
        // The readline path (promptForInstruction) handles # memory storage,
        // but instructions from the Ink queue bypass that path.
        if (instruction.startsWith('#')) {
          const content = instruction.slice(1).trim();
          if (host.inkRenderer) {
            host.modalActive = true;
            host.inkRenderer.pause();
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          try {
            await host.handleMemoryStore(content);
          } finally {
            if (host.inkRenderer) {
              host.modalActive = false;
              await host.inkRenderer.resume();
            }
          }
          continue;
        }

        // Ensure background init is complete before processing any instruction.
        // This runs while the user was typing, so it's usually already done.
        await host.ensureInitComplete();
        host.flushMcpStartupSummaryIfPending();

        // Check idle timeout — force logout if session has been idle too long.
        // Must check BEFORE updating lastActivityAt so the idle duration is accurate.
        if (host.runtime.config.auth?.token) {
          const idleMs = Date.now() - host.lastActivityAt;
          const timeoutMs = AUTH_CONFIG.idleTimeoutMs;
          if (idleMs >= timeoutMs) {
            await host.forceIdleLogout();
            return;
          }
        }

        // Update activity timestamp on every user interaction
        host.lastActivityAt = Date.now();

        if (instruction.trim() === '/exit' || instruction.trim() === '/quit') {
          // Fire-and-forget: don't block quit on telemetry
          host.telemetryManager.trackCommand({ command: instruction }).catch(() => {});
          const trigger = host.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = host.sessionManager.getCurrentSession();
            await host.showFeedbackWithPause(trigger, session?.metadata.sessionId);
          }
          await host.closeSession();
          return;
        }

        const isSlashCommand = instruction.startsWith('/');
        if (isSlashCommand) {
          await host.telemetryManager.trackCommand({ command: instruction.split(' ')[0] });
        }

        // Reset error tracking on successful prompt
        host.lastErrorMessage = null;
        host.consecutiveErrorCount = 0;

        // Check shouldExit before processing the instruction
        if (host.shouldExit) {
          return;
        }

        const turnStartTime = Date.now();
        await host.runInstruction(instruction);
        host.flushMcpStartupSummaryIfPending();

        // Start generating next-step suggestion in background.
        // The promise is awaited in promptForInstruction() with a deadline
        // so the LLM call runs concurrently with hooks/notifications below.
        if (host.suggestionEngine) {
          host.pendingSuggestion = host.suggestionEngine.generate(host.conversation.history());
          host.persistentInput.setPendingSuggestion(host.pendingSuggestion);
          host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion);
        }

        // Fire stop hook after turn completes (non-blocking)
        const turnDuration = Date.now() - turnStartTime;
        const session = host.sessionManager.getCurrentSession();
        const snapshot = host.getStatusSnapshot();
        host.hookManager.executeHooks('stop', {
          sessionId: session?.metadata.sessionId,
          turnDuration,
          tokensUsed: snapshot.tokensUsed,
          tokensUsageStatus: snapshot.tokensUsageStatus,
        }).catch(() => {
          // Ignore hook errors - they shouldn't block the user
        });

        // Restore stdin to known state after hook execution
        // Hook commands with shell: true can sometimes leave stdin in unexpected state
        host.ensureStdinReady();

        // Ring terminal bell to notify user (shows badge on terminal tab)
        if (host.runtime.config.ui?.terminalBell !== false) {
          process.stdout.write('\x07');
        }

        // Native OS notification for task completion
        if (host.runtime.config.ui?.showCompletionNotification !== false) {
          host.notificationService.notify(
            { body: host.getCompletionNotificationBody(), reason: 'task_complete' },
            host.getNotificationGuards()
          ).catch(() => {});
        }

        host.feedbackManager.recordInteraction();
        host.telemetryManager.recordInteraction();

        const feedbackTrigger = host.feedbackManager.shouldPrompt({
          userMessage: instruction,
          taskCompleted: true
        });

        if (feedbackTrigger) {
          const session = host.sessionManager.getCurrentSession();
          await host.showFeedbackWithPause(feedbackTrigger, session?.metadata.sessionId);
        }

        console.log();
      } catch (error) {
        const errorObj = error as any;
        const isCancel = errorObj.name === 'ExitPromptError' ||
          errorObj.isCanceled ||
          errorObj.message?.includes('canceled') ||
          errorObj.message?.includes('User force closed') ||
          !errorObj.message;

        if (isCancel) {
          host.lastErrorMessage = null;
          host.consecutiveErrorCount = 0;
          continue;
        }

        // TTY/IO errors (errno 5 = EIO, setRawMode failures) are unrecoverable.
        // Exit immediately instead of retrying — the terminal is gone.
        const isTTYError = /setRawMode|errno:\s*\d+|EIO|EPERM/.test(errorObj.message ?? '');
        if (isTTYError) {
          await host.errorLogger.log(error as Error, {
            context: 'Interactive loop (TTY failure)',
            workspace: host.runtime.workspaceRoot
          });
          const session = host.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'completed';
            await session.save();
          }
          await host.telemetryManager.endSession('completed');
          return;
        }

        const errorMessage = host.getDisplayErrorMessage(error);

        // Track consecutive identical errors to prevent infinite telemetry spam
        if (errorMessage === host.lastErrorMessage) {
          host.consecutiveErrorCount++;
        } else {
          host.lastErrorMessage = errorMessage;
          host.consecutiveErrorCount = 1;
        }

        // Only send telemetry for the first occurrence of a repeated error
        if (host.consecutiveErrorCount <= 1) {
          await host.errorLogger.log(error as Error, {
            context: 'Interactive loop',
            workspace: host.runtime.workspaceRoot
          });

          await host.telemetryManager.trackError({
            type: 'interactive_loop_error',
            message: errorMessage,
            stack: (error as Error).stack,
            context: 'Interactive loop'
          });

          // Auto-report to GitHub (fire-and-forget, non-blocking)
          host.autoReportManager.reportError(error as Error, {
            errorType: 'interactive_loop_error',
            model: host.runtime.options.model ?? getProviderConfig(host.runtime.config, host.activeProvider)?.model,
            provider: host.activeProvider,
            sessionId: host.sessionManager.getCurrentSession()?.metadata.sessionId,
            conversationLength: host.conversation.history().length,
            contextUsagePercent: Math.round((1 - host.contextPercentLeft / 100) * 100),
          }).catch(() => {});
        }

        // Exit if the same error repeats 3 times - it won't fix itself
        if (host.consecutiveErrorCount >= 3) {
          console.error(chalk.red(`\nFatal: "${errorMessage}" repeated ${host.consecutiveErrorCount} times. Exiting.`));
          const session = host.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'crashed';
            await session.save();
          }
          await host.telemetryManager.endSession('crashed');
          process.exitCode = 1;
          return;
        }

        const session = host.sessionManager.getCurrentSession();
        if (session) {
          session.metadata.status = 'crashed';
          await session.save();
        }

        host.reportInteractiveLoopError(errorMessage);
        console.error(chalk.gray(`Error logged to: ${host.errorLogger.getLogPath()}\n`));

        continue;
      }
    }
  }
