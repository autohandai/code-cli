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
import { formatElapsedTime, formatSessionActualTokens, formatTurnUsage } from './AgentFormatter.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';

export interface AgentUIRuntimeHost {
  [key: string]: any;
}

const USER_NOTIFICATION_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_PENDING_INK_SUBMIT_ECHOES = 20;

export function handleAgentCtrlCExitRequest(host: AgentUIRuntimeHost): void {
  if (host.shouldExit) {
    return;
  }

  host.shouldExit = true;
  host.clearAllQueuesAndAbort();
}

function normalizeSubmittedInstructionEcho(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function getPendingInkSubmittedInstructionEchoes(host: AgentUIRuntimeHost): string[] {
  if (!Array.isArray(host.inkSubmittedInstructionEchoes)) {
    host.inkSubmittedInstructionEchoes = [];
  }
  return host.inkSubmittedInstructionEchoes;
}

export function consumeAgentInkSubmittedInstructionEcho(host: AgentUIRuntimeHost, text: string): boolean {
  const normalized = normalizeSubmittedInstructionEcho(text);
  if (!normalized) {
    return false;
  }

  const echoes = getPendingInkSubmittedInstructionEchoes(host);
  const index = echoes.indexOf(normalized);
  if (index === -1) {
    return false;
  }

  echoes.splice(index, 1);
  return true;
}

function shouldEchoInkSubmittedInstructionImmediately(host: AgentUIRuntimeHost, text: string): boolean {
  const normalized = normalizeSubmittedInstructionEcho(text);
  if (!normalized || normalized.startsWith('!') || normalized.startsWith('#')) {
    return false;
  }

  if (host.isInstructionActive) {
    return false;
  }

  if (!host.inkRenderer) {
    return false;
  }

  return typeof host.inkRenderer.isRunning === 'function'
    ? host.inkRenderer.isRunning()
    : true;
}

function echoInkSubmittedInstructionImmediately(host: AgentUIRuntimeHost, text: string): void {
  if (!shouldEchoInkSubmittedInstructionImmediately(host, text)) {
    return;
  }

  const normalized = normalizeSubmittedInstructionEcho(text);
  host.inkRenderer?.addUserMessage?.(normalized);

  const echoes = getPendingInkSubmittedInstructionEchoes(host);
  echoes.push(normalized);
  if (echoes.length > MAX_PENDING_INK_SUBMIT_ECHOES) {
    echoes.splice(0, echoes.length - MAX_PENDING_INK_SUBMIT_ECHOES);
  }
}

function shouldSuppressDuplicateNotification(host: AgentUIRuntimeHost, message: string): boolean {
  const now = Date.now();
  const recentNotifications: Map<string, number> =
    host.recentUserNotifications instanceof Map
      ? host.recentUserNotifications
      : new Map<string, number>();

  host.recentUserNotifications = recentNotifications;

  const previousAt = recentNotifications.get(message);
  if (previousAt !== undefined && now - previousAt < USER_NOTIFICATION_DEDUPE_WINDOW_MS) {
    return true;
  }

  recentNotifications.set(message, now);

  for (const [content, shownAt] of recentNotifications) {
    if (now - shownAt >= USER_NOTIFICATION_DEDUPE_WINDOW_MS) {
      recentNotifications.delete(content);
    }
  }

  return false;
}

function getDisplayTurnUsage(host: AgentUIRuntimeHost) {
  if (host.currentTurnActualUsage) {
    return host.currentTurnActualUsage;
  }
  if (typeof host.totalTokensUsed === 'number' && host.totalTokensUsed > 0) {
    return {
      kind: 'actual' as const,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: host.totalTokensUsed,
    };
  }
  return undefined;
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
          handleAgentCtrlCExitRequest(host);
        },
        enableQueueInput: true,
        onImageDetected: (data: Buffer, mimeType: string, filename?: string) =>
          host.imageManager.add(data, mimeType, filename),
        filesProvider: () => host.workspaceFileCollector.getCachedFiles(),
        slashCommands: SLASH_COMMANDS,
        workspaceRoot: host.runtime?.workspaceRoot,
        resolveShellSuggestion: (input) =>
          typeof host.resolveLlmShellSuggestion === 'function'
            ? host.resolveLlmShellSuggestion(input)
            : Promise.resolve(null),
        suggestionProvider: () => host.suggestionEngine?.getNextPromptSuggestion() ?? undefined,
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
        suggestionProvider: () => host.suggestionEngine?.getNextPromptSuggestion() ?? undefined,
      });
    }
  }

export async function initializeAgentUI(host: AgentUIRuntimeHost, abortController?: AbortController, onCancel?: () => void, suppressSpinner = false): Promise<void> {
    writeAutohandDebugLine(
      `[DEBUG] initializeUI: useInkRenderer=${host.useInkRenderer}, stdout.isTTY=${process.stdout.isTTY}, stdin.isTTY=${process.stdin.isTTY}`,
      host.writeDebugLine?.bind(host)
    );
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
        
        // Ensure fallback spinner is NOT initialized when Ink is active
        if (host.runtime?.spinner) {
          host.runtime.spinner.stop();
          host.runtime.spinner = undefined;
        }
      } catch (err) {
        // Fall back to ora spinner if ink can't be loaded (e.g., standalone binary)
        writeAutohandDebugLine(
          `[DEBUG] InkRenderer initialization failed: ${err instanceof Error ? err.message : String(err)}`,
          host.writeDebugLine?.bind(host)
        );
        host.useInkRenderer = false;
        if (!suppressSpinner) {
          host.initFallbackSpinner();
        }
      }
    } else if (!suppressSpinner) {
      // Only initialize fallback spinner if Ink is not being used
      host.initFallbackSpinner();
    }
    // In non-TTY mode (RPC), skip spinner entirely
  }

export function initAgentFallbackSpinner(host: AgentUIRuntimeHost): void {
    // Only initialize fallback spinner if Ink is not active
    if (host.inkRenderer) {
      return;
    }
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
      host.inkRenderer.setElapsed(formatElapsedTime(host.taskStartedAt ?? host.sessionStartedAt));
      host.inkRenderer.setTokens(formatTurnUsage(getDisplayTurnUsage(host)));
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
    writeAutohandDebugLine(
      `[DEBUG] cleanupUI called: keepInkAlive=${keepInkAlive}, inkRenderer exists=${!!host.inkRenderer}`,
      host.writeDebugLine?.bind(host)
    );
    if (host.inkRenderer) {
      if (keepInkAlive) {
        // Transition to idle state instead of destroying Ink.
        // Queued instructions stay in Ink so runInteractiveLoop can dequeue
        // directly on the next iteration without a full unmount/remount cycle.
        host.inkRenderer.setWorking(false);
        writeAutohandDebugLine('[DEBUG] cleanupUI: set working to false', host.writeDebugLine?.bind(host));
      } else {
        // Preserve queued instructions before stopping
        while (host.inkRenderer.hasQueuedInstructions()) {
          const instruction = host.inkRenderer.dequeueInstruction();
          if (instruction) {
            host.pendingInkInstructions.push(instruction);
          }
        }
        writeAutohandDebugLine('[DEBUG] cleanupUI: stopping inkRenderer', host.writeDebugLine?.bind(host));
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
    const tokens = formatTurnUsage(getDisplayTurnUsage(host));
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
    const content = message.trim();
    if (!content || shouldSuppressDuplicateNotification(host, content)) {
      return;
    }

    if (host.inkRenderer?.isRunning()) {
      host.inkRenderer.addNotification(content);
      return;
    }

    if (
      host.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0'
    ) {
      host.persistentInput.writeAbove(`${chalk.yellow(content)}\n`);
      return;
    }

    promptNotify(chalk.yellow(content));
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

    echoInkSubmittedInstructionImmediately(host, text);
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
    writeAutohandDebugLine(
      `[DEBUG] executeImmediateShellCommandForInk: started ${shellCmd}, commandId=${commandId}`,
      host.writeDebugLine?.bind(host)
    );
    const result = await executeStreamingShellCommand(shellCmd, host.runtime.workspaceRoot, {
      onStdout: (chunk) => {
        writeAutohandDebugLine(`[DEBUG] onStdout chunk: ${JSON.stringify(chunk)}`, host.writeDebugLine?.bind(host));
        host.inkRenderer?.appendLiveCommandOutput(commandId, 'stdout', chunk);
      },
      onStderr: (chunk) => {
        writeAutohandDebugLine(`[DEBUG] onStderr chunk: ${JSON.stringify(chunk)}`, host.writeDebugLine?.bind(host));
        host.inkRenderer?.appendLiveCommandOutput(commandId, 'stderr', chunk);
      },
      preferPty: host.shouldPreferPtyForImmediateShellCommands(),
      columns: process.stdout.columns,
      rows: process.stdout.rows,
    });
    writeAutohandDebugLine(
      `[DEBUG] executeImmediateShellCommandForInk: finished, result=${JSON.stringify(result)}`,
      host.writeDebugLine?.bind(host)
    );
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
    const currentActual = host.currentTurnActualUsage?.kind === 'actual'
      ? host.currentTurnActualUsage.totalTokens
      : (host.currentTurnActualUsage ? 0 : (host.totalTokensUsed ?? 0));
    const sessionStatus = host.sessionTokenUsageUnavailable || host.currentTurnHadUnavailableUsage
      ? 'unavailable'
      : 'actual';
    const sessionTotal = (host.sessionActualTokensUsed ?? host.sessionTokensUsed ?? 0) + currentActual;
    const tokens = formatSessionActualTokens(sessionTotal, sessionStatus);
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
