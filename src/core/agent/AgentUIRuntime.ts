/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import ora from 'ora';
import { createInkUIManager } from '../../ui/InkUIManager.js';
import { createPlainUIManager } from '../../ui/PlainUIManager.js';
import { getPromptBlockWidth, promptNotify } from '../../ui/inputPrompt.js';
import { executeShellCommandAsync, executeStreamingShellCommand, isShellCommand, parseShellCommand } from '../../ui/shellCommand.js';
import { createImmediateShellCommandBlockWriter, formatImmediateShellCommandHeader } from '../immediateCommandRouter.js';
import { SLASH_COMMANDS } from '../slashCommands.js';
import { formatElapsedTime, formatTokens } from './AgentFormatter.js';

export interface AgentUIRuntimeHost {
  [key: string]: any;
}

export interface ImmediateShellRouteOptions {
  persistentInputActiveTurn: boolean;
  terminalRegionsDisabled: boolean;
  writeAbove: (text: string) => void;
}

export interface ShellCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export function initializeAgentUIManager(host: AgentUIRuntimeHost): void {
    if (host.ui) {
      return; // Already initialized
    }

    const isTTY = process.stdout.isTTY && process.stdin.isTTY;

    if (host.useInkRenderer && isTTY) {
      // Create Ink UIManager
      const inkUIManager = createInkUIManager({
        onInstruction: (text: string) => { void host.handleInkSubmittedInstruction(text); },
        onEscape: () => {
          const ctrl = host.currentInkAbortController;
          if (ctrl && !ctrl.signal.aborted) {
            ctrl.abort();
            host.currentInkOnCancel?.();
          }
        },
        onCtrlC: () => {
          // Ctrl+C handling - could trigger graceful shutdown
        },
        enableQueueInput: true,
        filesProvider: () => host.workspaceFileCollector.getCachedFiles(),
        slashCommands: SLASH_COMMANDS,
        skillsProvider: () =>
          host.skillsRegistry.listSkills().map((skill: { name: string; description?: string; isActive: boolean; source: string }) => ({
            name: skill.name,
            description: skill.description ?? '',
            isActive: skill.isActive,
            source: skill.source,
          })),
      });
      host.ui = inkUIManager;
    } else {
      // Create Plain UIManager
      const disableTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS === '0';
      host.ui = createPlainUIManager({
        workspaceRoot: host.runtime.workspaceRoot,
        silentMode: disableTerminalRegions,
        resolveShellSuggestion: (input) => host.resolveLlmShellSuggestion(input),
        suggestionProvider: () => host.suggestionEngine?.getSuggestion() ?? undefined,
      });
    }
  }

export async function initializeAgentUI(host: AgentUIRuntimeHost, abortController?: AbortController, onCancel?: () => void, suppressSpinner = false): Promise<void> {
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] initializeUI: useInkRenderer=${host.useInkRenderer}, stdout.isTTY=${process.stdout.isTTY}, stdin.isTTY=${process.stdin.isTTY}`);
    }
    if (host.useInkRenderer && process.stdout.isTTY && process.stdin.isTTY) {
      try {
        // Update the shared abort controller reference so Ink's onEscape
        // always targets the current turn (even when reusing Ink across turns).
        host.currentInkAbortController = abortController ?? null;
        host.currentInkOnCancel = onCancel ?? null;

        host.syncProviderModelStatusLine();
        await host.ui?.start();
        host.inkRenderer = host.ui?.getInkRenderer?.() ?? host.inkRenderer;
        host.ui?.setWorking(true, 'Gathering context...');
        host.runtime.inkRenderer = host.inkRenderer;
      } catch (err) {
        // Fall back to ora spinner if ink can't be loaded (e.g., standalone binary)
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] InkRenderer initialization failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        host.useInkRenderer = false;
        if (!suppressSpinner) {
          host.initFallbackSpinner();
        }
      }
    } else if (!suppressSpinner) {
      host.initFallbackSpinner();
    }
    // In non-TTY mode (RPC), skip spinner entirely
  }

export function initAgentFallbackSpinner(host: AgentUIRuntimeHost): void {
    if (process.stdout.isTTY) {
      const spinner = ora({
        text: 'Gathering context...',
        spinner: 'dots'
      }).start();
      host.runtime.spinner = spinner;
    }
  }

export function setAgentUIStatus(host: AgentUIRuntimeHost, status: string): void {
    if (host.inkRenderer) {
      host.inkRenderer.setStatus(status);
    } else if (host.runtime.spinner) {
      // setSpinnerStatus already handles terminal regions internally
      host.setSpinnerStatus(status);
    } else if (host.isUsingTerminalRegionsForActiveTurn()) {
      // No spinner (suppressed when persistent input is used) — route directly
      host.setPersistentInputActivityLine(status);
    }
  }

export function setAgentComposerIdle(host: AgentUIRuntimeHost): void {
    if (host.inkRenderer?.isRunning()) {
      host.inkRenderer.setWorking(false);
    }
    host.ui?.setWorking(false);
  }

export function clearAgentComposerInput(host: AgentUIRuntimeHost): void {
    host.inkRenderer?.clearInput();
    host.ui?.clearInput();
  }

export function setAgentComposerFinalResponse(host: AgentUIRuntimeHost, response: string): void {
    host.inkRenderer?.setFinalResponse(response);
    host.ui?.setFinalResponse(response);
  }

export function stopAgentUI(host: AgentUIRuntimeHost, failed = false, message?: string): void {
    if (host.inkRenderer) {
      // Update final stats before stopping (session totals for completionStats)
      host.inkRenderer.setElapsed(formatElapsedTime(host.sessionStartedAt));
      host.inkRenderer.setTokens(formatTokens(host.sessionTokensUsed + host.totalTokensUsed));
      host.inkRenderer.setWorking(false);
      if (message) {
        host.inkRenderer.setFinalResponse(message);
      }
      // Don't stop InkRenderer here - let it stay for final response display
    } else if (host.runtime.spinner) {
      if (failed && message) {
        host.runtime.spinner.fail(message);
      } else {
        host.runtime.spinner.stop();
      }
    }
  }

export function cleanupAgentUI(host: AgentUIRuntimeHost, keepInkAlive = false): void {
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] cleanupUI called: keepInkAlive=${keepInkAlive}, inkRenderer exists=${!!host.inkRenderer}`);
    }
    if (host.inkRenderer) {
      if (keepInkAlive) {
        // Transition to idle state instead of destroying Ink.
        // Queued instructions stay in Ink so runInteractiveLoop can dequeue
        // directly on the next iteration without a full unmount/remount cycle.
        host.inkRenderer.setWorking(false);
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] cleanupUI: set working to false`);
        }
      } else {
        // Preserve queued instructions before stopping
        while (host.inkRenderer.hasQueuedInstructions()) {
          const instruction = host.inkRenderer.dequeueInstruction();
          if (instruction) {
            host.pendingInkInstructions.push(instruction);
          }
        }
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] cleanupUI: stopping inkRenderer`);
        }
        host.inkRenderer.stop();
        host.inkRenderer = null;
        host.runtime.inkRenderer = undefined;
        // Clear any pending resolver so the idle-wait promise doesn't hang
        host.inkInstructionResolver = null;
      }
    }
    if (host.runtime.spinner) {
      host.runtime.spinner.stop();
      host.runtime.spinner = undefined;
    }
  }

export function printAgentCompletionSummary(host: AgentUIRuntimeHost, regionsStillActive: boolean): void {
    if (!host.taskStartedAt) return;
    const elapsed = formatElapsedTime(host.taskStartedAt);
    const tokens = formatTokens(host.totalTokensUsed);
    const queueCount = host.pendingInkInstructions.length +
      (host.inkRenderer?.getQueueCount() ?? 0) +
      host.persistentInput.getQueueLength();
    const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';
    const message = chalk.gray(`Completed in ${elapsed} · ${tokens} used${queueStatus}`);

    if (regionsStillActive) {
      host.persistentInput.writeAbove(message + '\n');
    } else {
      console.log(message);
    }
  }

export function notifyAgentUser(host: AgentUIRuntimeHost, message: string): void {
    if (host.inkRenderer?.isRunning()) {
      host.inkRenderer.setStatus(message);
      return;
    }

    if (
      host.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0'
    ) {
      host.persistentInput.writeAbove(`${chalk.yellow(message)}\n`);
      return;
    }

    promptNotify(chalk.yellow(message));
  }

export async function showAgentFeedbackWithPause(host: AgentUIRuntimeHost, trigger: string, sessionId?: string): Promise<void> {
    const needsPause = host.persistentInputActiveTurn;

    if (needsPause) {
      host.persistentInput.pause();
    }

    try {
      if (trigger === 'gratitude') {
        await host.feedbackManager.quickRating();
      } else {
        await host.feedbackManager.promptForFeedback(trigger as any, sessionId);
      }
    } catch {
      // Feedback should never crash the session
    } finally {
      if (needsPause) {
        host.persistentInput.resume();
      }
    }
  }

export function addAgentUIToolOutput(host: AgentUIRuntimeHost, tool: string, success: boolean, output: string): void {
    if (host.inkRenderer) {
      host.inkRenderer.addToolOutput(tool, success, output);
    }
    // For ora mode, we use console.log (handled separately)
  }

export function addAgentUIToolOutputs(host: AgentUIRuntimeHost, outputs: Array<{ tool: string; success: boolean; output: string; thought?: string }>): void {
    if (host.inkRenderer) {
      host.inkRenderer.addToolOutputs(outputs);
    }
    // For ora mode, we use console.log (handled separately)
  }

export async function handleAgentInkSubmittedInstruction(host: AgentUIRuntimeHost, text: string): Promise<void> {
    if (isShellCommand(text)) {
      await host.executeImmediateShellCommand(parseShellCommand(text));
      return;
    }

    host.inkRenderer?.addQueuedInstruction(text);

    // If the interactive loop is idle-waiting for the next Composer input,
    // resolve the promise so it can dequeue and process host instruction.
    if (host.inkInstructionResolver) {
      host.inkInstructionResolver();
      host.inkInstructionResolver = null;
    }
  }

export function shouldAgentPreferPtyForImmediateShellCommands(_host: AgentUIRuntimeHost): boolean {
    return false;
  }

export async function executeAgentImmediateShellCommand(host: AgentUIRuntimeHost, shellCmd: string, routeOpts?: ImmediateShellRouteOptions): Promise<ShellCommandResult> {
    if (host.inkRenderer) {
      return host.executeImmediateShellCommandForInk(shellCmd);
    }

    return host.executeImmediateShellCommandForComposer(shellCmd, routeOpts);
  }

export async function executeAgentImmediateShellCommandForComposer(host: AgentUIRuntimeHost, shellCmd: string, routeOpts?: ImmediateShellRouteOptions): Promise<ShellCommandResult> {
    if (routeOpts) {
      const writer = createImmediateShellCommandBlockWriter(shellCmd, routeOpts);
      const result = await executeShellCommandAsync(shellCmd, host.runtime.workspaceRoot, undefined, {
        onStdout: (chunk) => writer.pushStdout(chunk),
        onStderr: (chunk) => writer.pushStderr(chunk),
      });
      writer.flush();
      return result;
    }

    console.log(chalk.cyan(formatImmediateShellCommandHeader(shellCmd)));
    const result = await executeShellCommandAsync(shellCmd, host.runtime.workspaceRoot, undefined, {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (!result.success) {
      console.log(chalk.red(result.error || 'Command failed'));
    }
    console.log();
    return result;
  }

export async function executeAgentImmediateShellCommandForInk(host: AgentUIRuntimeHost, shellCmd: string): Promise<ShellCommandResult> {
    if (!host.inkRenderer) {
      return { success: false, error: 'Ink renderer is unavailable' };
    }

    const commandId = host.inkRenderer.startLiveCommand(`! ${shellCmd}`);
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] executeImmediateShellCommandForInk: started ${shellCmd}, commandId=${commandId}`);
    }
    const result = await executeStreamingShellCommand(shellCmd, host.runtime.workspaceRoot, {
      onStdout: (chunk) => {
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] onStdout chunk: ${JSON.stringify(chunk)}`);
        }
        host.inkRenderer?.appendLiveCommandOutput(commandId, 'stdout', chunk);
      },
      onStderr: (chunk) => {
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] onStderr chunk: ${JSON.stringify(chunk)}`);
        }
        host.inkRenderer?.appendLiveCommandOutput(commandId, 'stderr', chunk);
      },
      preferPty: host.shouldPreferPtyForImmediateShellCommands(),
      columns: process.stdout.columns,
      rows: process.stdout.rows,
    });
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] executeImmediateShellCommandForInk: finished, result=${JSON.stringify(result)}`);
    }
    host.inkRenderer.finishLiveCommand(commandId, result.success, result.error);
    return result;
  }

export function updateAgentInputLine(host: AgentUIRuntimeHost): void {
    // Just trigger a render - the render function will use current queueInput
    host.forceRenderSpinner();
  }

export function forceRenderAgentSpinner(host: AgentUIRuntimeHost): void {
    if (!host.taskStartedAt) return;

    const elapsed = formatElapsedTime(host.taskStartedAt);
    // Show session total tokens (includes current task + previous tasks in session)
    const sessionTotal = host.sessionTokensUsed + host.totalTokensUsed;
    const tokens = formatTokens(sessionTotal);
    const queueCount = host.inkRenderer?.getQueueCount() ?? host.persistentInput.getQueueLength();
    const queueHint = queueCount > 0 ? ` [${queueCount} queued]` : '';
    const verb = host.activityIndicator?.getVerb?.() ?? 'Working';
    const statusLine = `${verb}... (esc to interrupt · ${elapsed} · ${tokens}${queueHint})`;
    const footerLine = host.formatStatusLine();
    host.persistentInput.setStatusLine(footerLine);
    const usingTerminalRegions = host.isUsingTerminalRegionsForActiveTurn();

    if (host.inkRenderer) {
      // InkRenderer handles its own state updates
      host.inkRenderer.setStatus(`${verb}...`);
      host.inkRenderer.setElapsed(elapsed);
      host.inkRenderer.setTokens(tokens);
      return;
    }

    const promptWidth = getPromptBlockWidth(process.stdout.columns);
    const footerText = host.formatSpinnerFooter(footerLine);
    const cacheKey = `${statusLine}|${footerText}|${promptWidth}|${usingTerminalRegions ? 'regions' : 'spinner'}`;

    // Only update if something actually changed
    if (cacheKey === host.lastRenderedStatus) return;
    host.lastRenderedStatus = cacheKey;

    if (usingTerminalRegions) {
      if (host.runtime.spinner?.isSpinning) {
        host.runtime.spinner.stop();
      }
      host.setPersistentInputActivityLine(statusLine);
      return;
    }

    if (!host.runtime.spinner) return;

    const fullText = host.buildSpinnerStatusText(statusLine, footerText);
    host.runtime.spinner.text = fullText;
  }

export function formatAgentSpinnerFooter(_host: AgentUIRuntimeHost, footer: { left: string; right?: string }): string {
    return footer.left + (footer.right ? ` · ${footer.right}` : '');
  }

export function buildAgentSpinnerStatusText(host: AgentUIRuntimeHost, statusLine: string, footerLine?: string): string {
    const promptWidth = getPromptBlockWidth(process.stdout.columns);
    // Ora prefixes the first line with the spinner glyph and a space.
    // Reserve 2 columns so wrapped status lines do not corrupt redraw.
    const statusWidth = Math.max(10, promptWidth - 2);
    const combined = footerLine ? `${statusLine} · ${footerLine}` : statusLine;
    return host.fitSpinnerLine(combined, statusWidth);
  }

export function fitAgentSpinnerLine(_host: AgentUIRuntimeHost, value: string, width: number): string {
    const plain = value.replace(/\u001b\[[0-9;]*m/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    if (width <= 0) {
      return '';
    }
    if (plain.length <= width) {
      return plain;
    }
    if (width === 1) {
      return '…';
    }
    return `${plain.slice(0, width - 1)}…`;
  }

export function setAgentSpinnerStatus(host: AgentUIRuntimeHost, status: string): void {
    const footerLine = host.formatStatusLine();
    host.persistentInput.setStatusLine(footerLine);

    if (host.isUsingTerminalRegionsForActiveTurn()) {
      if (host.runtime.spinner?.isSpinning) {
        host.runtime.spinner.stop();
      }
      host.setPersistentInputActivityLine(status);
      return;
    }

    if (!host.runtime.spinner) {
      return;
    }

    const footerText = footerLine.left + (footerLine.right ? ` · ${footerLine.right}` : '');
    host.runtime.spinner.text = host.buildSpinnerStatusText(status, footerText);
  }

export function startAgentStatusUpdates(host: AgentUIRuntimeHost): void {
    if (host.statusInterval) {
      clearInterval(host.statusInterval);
    }

    // Reset tracking state
    host.lastRenderedStatus = '';

    // Pick a fresh verb and tip for host working session
    host.activityIndicator?.next?.();

    // Immediate initial render
    host.forceRenderSpinner();

    // Update every second for elapsed time, but forceRenderSpinner
    // handles deduplication so frequent calls are fine
    host.statusInterval = setInterval(() => {
      host.forceRenderSpinner();
    }, 1000); // Once per second is enough for time updates

    if (process.stdout.isTTY && !host.resizeHandler) {
      host.resizeHandler = () => {
        host.lastRenderedStatus = '';
        if (host.runtime.spinner?.isSpinning) {
          host.runtime.spinner.stop();
          if (!host.isUsingTerminalRegionsForActiveTurn()) {
            host.runtime.spinner.start();
          }
        }
        host.forceRenderSpinner();
      };
      process.stdout.on('resize', host.resizeHandler);
    }
  }

export function stopAgentStatusUpdates(host: AgentUIRuntimeHost): void {
    if (host.statusInterval) {
      clearInterval(host.statusInterval);
      host.statusInterval = null;
    }
    if (host.resizeHandler) {
      process.stdout.off('resize', host.resizeHandler);
      host.resizeHandler = null;
    }
    if (host.isUsingTerminalRegionsForActiveTurn()) {
      host.setPersistentInputActivityLine('');
    }
  }

export function isAgentUsingTerminalRegionsForActiveTurn(host: AgentUIRuntimeHost): boolean {
    return host.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0' &&
      !host.useInkRenderer;
  }

export function setAgentPersistentInputActivityLine(host: AgentUIRuntimeHost, activity: string): void {
    const persistentInputWithActivity = host.persistentInput as {
      setActivityLine?: (value: string) => void;
    } | undefined;
    persistentInputWithActivity?.setActivityLine?.(activity);
  }

export function ensureAgentSpinnerRunning(host: AgentUIRuntimeHost): void {
    if (!host.runtime.spinner) {
      return;
    }
    if (host.isUsingTerminalRegionsForActiveTurn()) {
      if (host.runtime.spinner.isSpinning) {
        host.runtime.spinner.stop();
      }
      return;
    }
    if (!host.runtime.spinner.isSpinning) {
      host.runtime.spinner.start();
    }
  }

export function resumeAgentSpinnerAfterModalPause(host: AgentUIRuntimeHost): void {
    if (!host.runtime.spinner) {
      return;
    }
    if (host.isUsingTerminalRegionsForActiveTurn()) {
      return;
    }
    host.runtime.spinner.start();
  }

export async function withAgentModalPause<T>(host: AgentUIRuntimeHost, fn: () => Promise<T>): Promise<T> {
    host.stopStatusUpdates();

    const spinnerWasSpinning = host.runtime.spinner?.isSpinning;
    if (spinnerWasSpinning) {
      host.runtime.spinner?.stop();
    }

    host.persistentInput.pause();

    if (host.inkRenderer) {
      host.inkRenderer.pause();
    }

    try {
      return await fn();
    } finally {
      if (host.inkRenderer) {
        await host.inkRenderer.resume();
      }

      host.persistentInput.resume();

      if (spinnerWasSpinning && host.runtime.spinner) {
        host.resumeSpinnerAfterModalPause();
      }

      host.startStatusUpdates();
    }
  }
