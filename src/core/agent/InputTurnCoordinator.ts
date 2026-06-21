/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import readline from 'node:readline';
import { format as formatText } from 'node:util';
import { ApiError, classifyApiError } from '../../providers/errors.js';
import { safeEmitKeypressEvents } from '../../ui/inputPrompt.js';
import { safeSetRawMode } from '../../ui/rawMode.js';
import { isImmediateCommand, isShellCommand, parseShellCommand } from '../../ui/shellCommand.js';
import { routeOutput } from '../immediateCommandRouter.js';
import { isLikelyFilePathSlashInput } from '../slashInputDetection.js';
import { describeInstruction, formatElapsedTime } from './AgentFormatter.js';
import { BARE_SLASH_COMMANDS_DISABLED_MESSAGE } from '../../runtime/bareMode.js';
import type { PersistentInput } from '../../ui/persistentInput.js';
import type { AgentRuntime } from '../../types.js';

type RawModeReadStream = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

interface InputInkRenderer {
  setElapsed(elapsed: string): void;
  setStatus(status: string): void;
}

interface ImmediateShellRouteOptions {
  persistentInputActiveTurn: boolean;
  terminalRegionsDisabled: boolean;
  writeAbove: (text: string) => void;
}

interface ImmediateShellResult {
  success: boolean;
  error?: string;
}

export interface AgentInputRecoveryHost {
  conversation: {
    isInitialized?: () => boolean;
    addSystemNote(content: string): void;
  };
}

export interface AgentInputTurnHost {
  conversation: AgentInputRecoveryHost['conversation'];
  executeImmediateShellCommandForComposer(command: string, routeOpts: ImmediateShellRouteOptions): Promise<ImmediateShellResult>;
  handleSlashCommand(command: string, args: string[]): Promise<string | null>;
  inkRenderer?: InputInkRenderer | null;
  isUsingTerminalRegionsForActiveTurn(): boolean;
  parseSlashCommand(input: string): { command: string; args: string[] };
  persistentConsoleBridgeCleanup: (() => void) | null;
  persistentInput: PersistentInput;
  persistentInputActiveTurn: boolean;
  queueInput: string;
  runtime: AgentRuntime;
  setPersistentInputActivityLine(status: string): void;
  setSpinnerStatus(status: string): void;
  updateInputLine(): void;
}

export function setupAgentEscListener(host: AgentInputTurnHost, controller: AbortController, onCancel: () => void, ctrlCInterrupt = false): () => void {
    const input = process.stdin as RawModeReadStream;
    if (!input.isTTY) {
      return () => { };
    }
    // Use safe version to prevent duplicate listener registration across turns
    safeEmitKeypressEvents(input);
    const supportsRaw = typeof input.setRawMode === 'function';
    const wasRaw = input.isRaw;
    if (!wasRaw && supportsRaw) {
      safeSetRawMode(input, true);
    }
    // promptOnce() pauses stdin during cleanup, so resume to keep queue capture alive mid-turn.
    try {
      input.resume();
    } catch {
      // Best effort, continue without failing interactive turn.
    }
    try {
      input.setEncoding('utf8');
    } catch {
      // Best effort, continue without failing interactive turn.
    }

    let ctrlCCount = 0;
    host.queueInput = '';
    const enableQueue = host.runtime.config.agent?.enableRequestQueue !== false;
    const enableEscQueueInput = enableQueue && !host.persistentInputActiveTurn;
    const rawEnabled = supportsRaw ? Boolean(input.isRaw) : false;
    const useLineQueueFallback = enableEscQueueInput && !rawEnabled;
    let lastKeypressAt = 0;
    let lineReader: readline.Interface | null = null;

    const submitQueueInput = () => {
      if (!host.queueInput.trim()) {
        return;
      }

      const text = host.queueInput.trim();
      host.queueInput = '';

      // Shell commands (!) and slash commands (/) execute immediately, never queued.
      // Route output through writeAbove() when terminal regions are active.
      if (isImmediateCommand(text)) {
        const routeOpts = {
          persistentInputActiveTurn: host.persistentInputActiveTurn,
          terminalRegionsDisabled: process.env.AUTOHAND_TERMINAL_REGIONS === '0',
          writeAbove: (t: string) => host.persistentInput.writeAbove(t),
        };

        if (isShellCommand(text)) {
          const cmd = parseShellCommand(text);
          host.executeImmediateShellCommandForComposer(cmd, routeOpts)
            .then((result) => {
              if (!result.success) {
                routeOutput(chalk.red(result.error || 'Command failed'), routeOpts);
              }
            })
            .catch((error: Error) => {
              routeOutput(chalk.red(error.message || 'Command failed'), routeOpts);
            });
        } else if (text.startsWith('/') && !isLikelyFilePathSlashInput(text)) {
          if (host.runtime.options.bare) {
            routeOutput(chalk.gray(BARE_SLASH_COMMANDS_DISABLED_MESSAGE), routeOpts);
            host.updateInputLine();
            return;
          }

          const { command, args } = host.parseSlashCommand(text);
          host.handleSlashCommand(command, args)
            .then((handled) => {
              if (handled !== null) {
                routeOutput(handled, routeOpts);
              }
            })
            .catch((err: Error) => {
              routeOutput(chalk.red(`\nCommand error: ${err.message}`), routeOpts);
            });
        }
        host.updateInputLine();
        return;
      }

      if (host.persistentInput.getQueueLength() >= 10) {
        host.updateInputLine();
        return;
      }
      host.persistentInput.enqueue(text);

      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      if (host.runtime.spinner) {
        host.runtime.spinner.text = chalk.cyan(`✓ Queued: "${preview}" (${host.persistentInput.getQueueLength()} pending)`);
      }
      host.updateInputLine();
    };

    const ingestTextChunk = (chunk: string) => {
      if (!chunk) {
        return;
      }

      const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const hasSubmit = normalized.includes('\n');
      const printable = normalized.replace(/\n/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      if (printable) {
        host.queueInput += printable;
      }

      if (hasSubmit) {
        submitQueueInput();
        return;
      }

      if (printable) {
        host.updateInputLine();
      }
    };

    const handler = (_str: string, key: readline.Key) => {
      if (controller.signal.aborted) {
        return;
      }

      // ESC to cancel
      if (key?.name === 'escape') {
        controller.abort();
        onCancel();
        return;
      }

      // Ctrl+C handling
      if (ctrlCInterrupt && key?.name === 'c' && key.ctrl) {
        ctrlCCount += 1;
        if (ctrlCCount >= 2) {
          controller.abort();
          onCancel();
        } else {
          console.log(chalk.gray('Press Ctrl+C again to exit.'));
        }
        return;
      }

      if (enableEscQueueInput) {
        if (useLineQueueFallback) {
          return;
        }

        if (key?.name === 'return' || key?.name === 'enter') {
          submitQueueInput();
          return;
        }

        if (key?.name === 'backspace') {
          host.queueInput = host.queueInput.slice(0, -1);
          host.updateInputLine();
          return;
        }

        if (key?.ctrl || key?.meta) {
          return;
        }

        if (_str) {
          lastKeypressAt = Date.now();
        }
        ingestTextChunk(_str);
      }
    };
    const dataHandler = (chunk: string | Buffer) => {
      if (controller.signal.aborted || !enableEscQueueInput) {
        return;
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const now = Date.now();
      // In raw mode, emitKeypressEvents and the data event can both fire for the same bytes.
      // Deduplicate those bursts to avoid double-queuing typed input.
      if (now - lastKeypressAt < 30) {
        return;
      }
      ingestTextChunk(text);
    };
    if (useLineQueueFallback) {
      lineReader = readline.createInterface({
        input,
        crlfDelay: Infinity,
        historySize: 0,
        terminal: false,
      });
      lineReader.on('line', (line) => {
        if (controller.signal.aborted) {
          return;
        }
        host.queueInput = line;
        submitQueueInput();
      });
    }

    input.on('keypress', handler);
    if (enableEscQueueInput && !useLineQueueFallback) {
      input.on('data', dataHandler);
    }

    return () => {
      input.off('keypress', handler);
      if (enableEscQueueInput && !useLineQueueFallback) {
        input.off('data', dataHandler);
      }
      lineReader?.close();
      lineReader = null;
      host.queueInput = ''; // Clear input on cleanup
      if (!wasRaw && supportsRaw) {
        safeSetRawMode(input, false);
      }
    };
  }

export function setupAgentPersistentInputInterruptHandlers(host: AgentInputTurnHost, controller: AbortController, onCancel: () => void): () => void {
    let ctrlCCount = 0;

    const onEscape = () => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort();
      onCancel();
    };

    const onCtrlC = () => {
      if (controller.signal.aborted) {
        return;
      }
      ctrlCCount += 1;
      if (ctrlCCount >= 2) {
        controller.abort();
        onCancel();
      } else {
        console.log(chalk.gray('Press Ctrl+C again to exit.'));
      }
    };

    host.persistentInput.on('escape', onEscape);
    host.persistentInput.on('ctrl-c', onCtrlC);

    return () => {
      host.persistentInput.off('escape', onEscape);
      host.persistentInput.off('ctrl-c', onCtrlC);
    };
  }

export function installAgentPersistentConsoleBridge(host: AgentInputTurnHost): () => void {
    if (host.persistentConsoleBridgeCleanup) {
      return () => {};
    }

    if (!host.persistentInputActiveTurn || process.env.AUTOHAND_TERMINAL_REGIONS === '0') {
      return () => {};
    }

    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const bridgeWriter = (fallback: (...args: unknown[]) => void) => (...args: unknown[]) => {
      if (!host.persistentInputActiveTurn || process.env.AUTOHAND_TERMINAL_REGIONS === '0') {
        fallback(...args);
        return;
      }
      const text = formatText(...args);
      host.persistentInput.writeAbove(`${text}\n`);
    };

    console.log = bridgeWriter(originalLog);
    console.info = bridgeWriter(originalInfo);
    console.warn = bridgeWriter(originalWarn);
    console.error = bridgeWriter(originalError);

    const restore = () => {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
      host.persistentConsoleBridgeCleanup = null;
    };

    host.persistentConsoleBridgeCleanup = restore;
    return restore;
  }

export function startAgentPreparationStatus(host: AgentInputTurnHost, instruction: string): () => void {
    const label = describeInstruction(instruction);
    const startedAt = Date.now();
    const update = () => {
      const elapsed = formatElapsedTime(startedAt);
      const status = `Preparing to ${label} (${elapsed} • esc to interrupt)`;
      if (host.inkRenderer) {
        host.inkRenderer.setStatus(status);
        host.inkRenderer.setElapsed(elapsed);
      } else if (host.runtime.spinner) {
        host.setSpinnerStatus(status);
      } else if (host.isUsingTerminalRegionsForActiveTurn()) {
        host.setPersistentInputActivityLine(status);
      }
    };
    update();
    let stopped = false;
    const interval = setInterval(update, 1000);
    return () => {
      if (stopped) {
        return;
      }
      clearInterval(interval);
      stopped = true;
    };
  }

export function agentSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

export function isAgentContextOverflowError(errorOrMessage: Error | string): boolean {
    // Prefer structured ApiError when available
    if (errorOrMessage instanceof ApiError) {
      return errorOrMessage.code === 'context_overflow';
    }

    // String fallback for non-ApiError providers — use the shared classifier
    const message = typeof errorOrMessage === 'string' ? errorOrMessage : errorOrMessage.message;
    const classified = classifyApiError(0, message);
    return classified.code === 'context_overflow';
  }

export function isAgentRetryableSessionError(error: Error): boolean {
    if (error instanceof ApiError) return error.retryable;
    const classified = classifyApiError(0, error.message);
    return classified.retryable;
  }

export function shouldUsePassiveAgentSessionRetry(error: Error): boolean {
    const code = error instanceof ApiError
      ? error.code
      : classifyApiError(0, error.message).code;

    return (
      code === 'network_error' ||
      code === 'timeout' ||
      code === 'rate_limited' ||
      code === 'server_error'
    );
  }

export function injectAgentContinuationMessage(host: AgentInputRecoveryHost, error: Error, retryAttempt: number): void {
    const conversation = host.conversation;
    if (typeof conversation.isInitialized === 'function' && !conversation.isInitialized()) {
      return;
    }

    const continuationPrompts = [
      // First retry: gentle continuation
      `[System Recovery] An error occurred (${error.message}). Please continue from where you left off. ` +
      `Review the conversation context and proceed with the next logical step. ` +
      `If you were in the middle of a tool call, retry it. If you completed tools, provide your response.`,

      // Second retry: more explicit
      `[System Recovery - Attempt ${retryAttempt + 1}] The previous operation encountered an error. ` +
      `Please analyze the current state and continue. Focus on completing the user's original request. ` +
      `If needed, you can re-read files or re-execute commands to verify the current state.`,

      // Third retry: most explicit with safety
      `[System Recovery - Final Attempt] Multiple errors have occurred. ` +
      `Please provide a status update to the user. If the task cannot be completed, ` +
      `explain what was accomplished and what remains. Do not attempt complex operations - ` +
      `focus on providing a helpful response.`
    ];

    const promptIndex = Math.min(retryAttempt, continuationPrompts.length - 1);
    const continuationMessage = continuationPrompts[promptIndex];

    // Add as a system note to preserve conversation flow
    conversation.addSystemNote(continuationMessage);
  }
