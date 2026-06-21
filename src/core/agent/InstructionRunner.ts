/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { ProviderNotConfiguredError } from '../../providers/ProviderFactory.js';
import { ApiError } from '../../providers/errors.js';
import {
  checkAndPromptForDirectoryPermissions,
  type DirectoryPermissionOptions,
} from '../../permissions/directoryPermissionPrompt.js';
import type { PermissionManager } from '../../permissions/PermissionManager.js';
import type { AgentOutputEvent, AgentRuntime, TurnUsage } from '../../types.js';
import type { Intent, IntentResult } from '../IntentDetector.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';
import { GoalManager } from '../../goals/GoalManager.js';

interface InstructionConversation {
  addMessage(message: { role: 'user'; content: string }): void;
  history(): unknown[];
}

interface InstructionIntentDetector {
  detect(instruction: string): IntentResult;
}

interface InstructionProviderConfigManager {
  promptModelSelection(): Promise<void>;
}

interface InstructionPersistentInput {
  start(): void;
  stop(): void;
  hasQueued(): boolean;
  getCurrentInput(): string;
  setCurrentInput(input: string): void;
  setStatusLine(statusLine: string | { left: string; right?: string }): void;
}

type InstructionInkRenderer = object;

interface EnvironmentBootstrapResult {
  success: boolean;
}

function isActualTurnUsage(usage: TurnUsage): usage is Extract<TurnUsage, { kind: 'actual' }> {
  return usage.kind === 'actual';
}

function readCompletedTurnUsage(host: AgentInstructionHost): TurnUsage {
  return host.currentTurnActualUsage;
}

export interface AgentInstructionHost {
  isInstructionActive: boolean;
  filesModifiedThisSession: boolean;
  lastAssistantResponseForNotification: string;
  taskStartedAt: number | null;
  totalTokensUsed: number;
  currentTurnActualUsage: TurnUsage;
  currentTurnHadUnavailableUsage: boolean;
  lastTurnActualUsage: TurnUsage;
  sessionActualTokensUsed: number;
  sessionTokenUsageUnavailable: boolean;
  lastIntent: Intent;
  activeAbortController: AbortController | null;
  persistentInputActiveTurn: boolean;
  promptSeedInput: string;
  useInkRenderer: boolean;
  inkRenderer: InstructionInkRenderer | null;
  modalActive: boolean;
  sessionRetryCount: number;
  sessionTokensUsed: number;
  runtime: AgentRuntime;
  permissionManager?: PermissionManager;
  intentDetector: InstructionIntentDetector;
  persistentInput: InstructionPersistentInput;
  conversation: InstructionConversation;
  providerConfigManager: InstructionProviderConfigManager;
  clearExplorationLog(): void;
  displayIntentMode(intentResult: IntentResult): void;
  runEnvironmentBootstrap(): Promise<EnvironmentBootstrapResult>;
  initializeUI(
    abortController?: AbortController,
    onCancel?: () => void,
    suppressSpinner?: boolean
  ): Promise<void>;
  stopStatusUpdates(): void;
  stopUI(failed?: boolean, message?: string): void;
  isUsingTerminalRegionsForActiveTurn(): boolean;
  installPersistentConsoleBridge(): () => void;
  formatStatusLine(): { left: string; right?: string };
  printUserInstructionToChatLog(instruction: string): void;
  setupPersistentInputInterruptHandlers(
    abortController: AbortController,
    onCancel: () => void
  ): () => void;
  setupEscListener(
    abortController: AbortController,
    onCancel: () => void,
    ctrlCInterrupt?: boolean
  ): () => void;
  startPreparationStatus(instruction: string): () => void;
  buildUserMessage(instruction: string): Promise<string>;
  setUIStatus(status: string): void;
  saveUserMessage(instruction: string): Promise<void>;
  updateContextUsage(history: unknown[]): void;
  runReactLoop(abortController: AbortController): Promise<void>;
  runQualityPipeline(): Promise<void>;
  cleanupUI(keepInkAlive?: boolean): void;
  runInstruction(instruction: string): Promise<boolean>;
  isRetryableSessionError(error: Error): boolean;
  submitSessionFailureBugReport(error: Error, attempt: number, maxRetries: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  shouldUsePassiveSessionRetry(error: Error): boolean;
  injectContinuationMessage(error: Error, attempt: number): void;
  getDisplayErrorMessage(error: unknown): string;
  emitOutput(event: AgentOutputEvent): void;
  printCompletionSummary(regionsStillActive: boolean): void;
  scheduleTurnMemoryReflection(success: boolean): void;
  writeDebugLine?(message: string): void;
}

export class InstructionRunner {
  constructor(private readonly host: AgentInstructionHost) {}

  async run(instruction: string): Promise<boolean> {
    const host = this.host;

    host.isInstructionActive = true;
    host.clearExplorationLog();
    host.filesModifiedThisSession = false;
    host.lastAssistantResponseForNotification = '';

    // Check for directory mentions outside workspace and prompt for permissions
    if (host.runtime.workspaceRoot && host.permissionManager) {
      const dirPermissionOptions: DirectoryPermissionOptions = {
        workspaceRoot: host.runtime.workspaceRoot,
        permissionManager: host.permissionManager,
        autoApprove: host.runtime.options.unrestricted || host.runtime.options.yes || false,
      };
      await checkAndPromptForDirectoryPermissions(instruction, dirPermissionOptions);
    }

    // Initialize task-level tracking
    host.taskStartedAt = Date.now();
    host.totalTokensUsed = 0;
    host.currentTurnActualUsage = {
      kind: 'unavailable',
      provider: host.runtime.config.provider,
      reason: 'not_reported',
    };
    host.currentTurnHadUnavailableUsage = false;

    // Detect user intent (diagnostic vs implementation)
    const intentResult = host.intentDetector.detect(instruction);
    host.lastIntent = intentResult.intent;

    // Display mode indicator
    host.displayIntentMode(intentResult);

    // Run environment bootstrap for implementation mode
    if (intentResult.intent === 'implementation') {
      const bootstrapResult = await host.runEnvironmentBootstrap();
      if (!bootstrapResult.success) {
        console.log(chalk.red('\n[BLOCKED] Environment setup failed. Fix issues before proceeding.'));
        host.isInstructionActive = false;
        return false;
      }
    }

    const abortController = new AbortController();
    host.activeAbortController = abortController;
    let canceledByUser = false;
    let success = true;

    const queueEnabled = host.runtime.config.agent?.enableRequestQueue !== false;
    const isCommandMode = host.runtime.isCommandMode === true || Boolean(host.runtime.options?.prompt);
    const canUsePersistentInput = !isCommandMode && process.stdout.isTTY && process.stdin.isTTY && queueEnabled;

    // Initialize UI (InkRenderer or ora spinner)
    // Pass abort controller for InkRenderer to handle ESC/Ctrl+C
    await host.initializeUI(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        host.stopStatusUpdates();
        host.stopUI();
        // Don't console.log here — terminal regions may still be active,
        // which routes output through writeAbove and corrupts the composer.
        // The cancel message is printed in the finally block after cleanup.
      }
    }, canUsePersistentInput);

    writeAutohandDebugLine(
      `[DEBUG] runInstruction: after initializeUI, inkRenderer exists=${!!host.inkRenderer}, useInkRenderer=${host.useInkRenderer}`,
      host.writeDebugLine?.bind(host)
    );

    const shouldUsePersistentInput = canUsePersistentInput && !host.inkRenderer;
    let cleanupConsoleBridge: () => void = () => {};

    if (shouldUsePersistentInput) {
      host.persistentInput.start();
      host.persistentInputActiveTurn = true;
      if (host.isUsingTerminalRegionsForActiveTurn() && host.runtime.spinner?.isSpinning) {
        host.runtime.spinner.stop();
      }
      cleanupConsoleBridge = host.installPersistentConsoleBridge();
      if (host.promptSeedInput && !host.persistentInput.getCurrentInput()) {
        host.persistentInput.setCurrentInput(host.promptSeedInput);
        host.promptSeedInput = '';
      }
      host.persistentInput.setStatusLine(host.formatStatusLine());
    } else {
      host.persistentInputActiveTurn = false;
    }

    // Print user instruction AFTER persistent input is started so it
    // renders inside the scroll region (not overwritten by the fixed region).
    host.printUserInstructionToChatLog(instruction);

    // Only one input owner should handle interrupts:
    // InkRenderer, PersistentInput, or fallback ESC listener.
    const handleCancel = () => {
      if (!canceledByUser) {
        canceledByUser = true;
        host.stopStatusUpdates();
        host.stopUI();
        // Don't console.log here — terminal regions may still be active,
        // which routes output through writeAbove and corrupts the composer.
        // The cancel message is printed in the finally block after cleanup.
      }
    };

    const cleanupEsc = host.useInkRenderer
      ? () => {} // No-op, Ink handles input
      : shouldUsePersistentInput
        ? host.setupPersistentInputInterruptHandlers(abortController, handleCancel)
        : host.setupEscListener(abortController, handleCancel, true);
    const stopPreparation = host.startPreparationStatus(instruction);
    try {
      const userMessage = await host.buildUserMessage(instruction);
      stopPreparation();
      host.setUIStatus('Reasoning with the AI (ReAct loop)...');
      host.conversation.addMessage({ role: 'user', content: userMessage });

      // Save user message to session
      await host.saveUserMessage(instruction);

      host.updateContextUsage(host.conversation.history());
      await host.runReactLoop(abortController);

      if (host.lastIntent === 'implementation' && host.filesModifiedThisSession) {
        host.modalActive = true;
        try {
          // PersistentInput uses terminal scroll regions that must be torn down
          // before child-process quality output is printed. Ink owns the live
          // composer tree, so keep it mounted to avoid per-turn flicker.
          if (host.persistentInputActiveTurn) {
            host.promptSeedInput = host.persistentInput.getCurrentInput();
            host.persistentInput.stop();
            host.persistentInputActiveTurn = false;
          }
          cleanupConsoleBridge();
          cleanupConsoleBridge = () => {}; // Prevent double-cleanup in finally
          await host.runQualityPipeline();
        } finally {
          host.modalActive = false;
        }
      }
    } catch (error) {
      success = false;
      if (abortController.signal.aborted) {
        return false;
      }

      // Handle unconfigured provider by prompting for configuration
      if (error instanceof ProviderNotConfiguredError) {
        host.cleanupUI();
        console.log(chalk.yellow(`\nNo provider is configured yet. Let's set one up!\n`));
        await host.providerConfigManager.promptModelSelection();
        // After configuration, retry the instruction
        return host.runInstruction(instruction);
      }

      // Loop guard aborts are handled gracefully inside runReactLoop
      // (fallback message already emitted to the user). Skip retries and
      // error UI so we don't double-print failure messages.
      if (error instanceof Error && error.name === 'LoopAbortedError') {
        // Fall through to finally with success = false
      } else {
        // Session failure retry logic
        const err = error instanceof Error ? error : new Error(String(error));
        const maxRetries = host.runtime.config.agent?.sessionRetryLimit ?? 3;
        const baseDelay = host.runtime.config.agent?.sessionRetryDelay ?? 1000;

        if (host.isRetryableSessionError(err) && host.sessionRetryCount < maxRetries) {
          host.sessionRetryCount++;

          // Submit bug report to telemetry
          await host.submitSessionFailureBugReport(err, host.sessionRetryCount, maxRetries);

          // Show retry message to user
          console.log(chalk.yellow(`\n⚠ Session encountered an error: ${err.message}`));
          console.log(chalk.cyan(`  Attempting recovery (${host.sessionRetryCount}/${maxRetries})...`));

          // Wait with exponential backoff (1.5x multiplier)
          const delay = Math.max(
            baseDelay * Math.pow(1.5, host.sessionRetryCount - 1),
            err instanceof ApiError ? err.retryAfterMs ?? 0 : 0
          );
          await host.sleep(delay);

          // Retry plain transport/service outages without mutating the prompt.
          // Injecting "continue the task" guidance after a dropped connection
          // causes the model to resume with extra behavioral instructions once
          // the service comes back, which can snowball into unnecessary tool use.
          if (!host.shouldUsePassiveSessionRetry(err)) {
            host.injectContinuationMessage(err, host.sessionRetryCount);
          }

          // Retry the ReAct loop
          try {
            host.setUIStatus('Recovering session...');
            await host.runReactLoop(abortController);

            // If we get here, retry succeeded - reset counter
            host.sessionRetryCount = 0;
            success = true;
            return success;
          } catch (retryError) {
            // Retry failed, will be caught by outer logic on next iteration
            // or fall through to final failure if max retries exceeded
            if (host.sessionRetryCount >= maxRetries) {
              // Max retries exceeded, fall through to failure
              host.sessionRetryCount = 0;
            } else {
              // Re-throw to trigger another retry attempt
              throw retryError;
            }
          }
        }

        // Reset retry counter on non-retryable errors or max retries exceeded
        host.sessionRetryCount = 0;

        host.stopUI(true, 'Session failed');
        // Emit error for RPC mode
        const errorMessage = host.getDisplayErrorMessage(error);
        host.emitOutput({ type: 'error', content: errorMessage });
        if (error instanceof Error) {
          console.error(chalk.red(errorMessage));
        } else {
          console.error(errorMessage);
        }
      }
    } finally {
      // IMPORTANT: Keep the console bridge active until AFTER terminal regions
      // are disabled. Otherwise, in-flight streaming output bypasses writeAbove
      // and writes directly to stdout while regions are still active, corrupting
      // the fixed-region composer box (overlapping borders, leaked tool data).
      cleanupEsc();
      stopPreparation();
      host.stopStatusUpdates();
      const keepPersistentInputForNextTurn =
        host.persistentInputActiveTurn &&
        (host.persistentInput.hasQueued() || host.persistentInput.getCurrentInput().trim().length > 0);
      if (host.persistentInputActiveTurn) {
        host.promptSeedInput = host.persistentInput.getCurrentInput();
      }
      // Stop the spinner BEFORE disabling scroll regions. ora tracks its
      // cursor position relative to the active scroll region; if regions are
      // reset first, ora.stop() moves the cursor to an incorrect absolute
      // row (typically row 1), causing the next prompt to render at the top.
      // When using Ink, keep the renderer alive between turns to prevent the
      // composer from disappearing and reappearing during back-to-back turns.
      writeAutohandDebugLine(
        `[DEBUG] runInstruction finally: useInkRenderer=${host.useInkRenderer}, inkRenderer exists=${!!host.inkRenderer}`,
        host.writeDebugLine?.bind(host)
      );
      host.cleanupUI(host.useInkRenderer);

      if (host.persistentInputActiveTurn && !keepPersistentInputForNextTurn) {
        host.persistentInput.stop();
        host.persistentInputActiveTurn = false;
      }

      // Restore original console AFTER regions are disabled so no output
      // leaks into the fixed-region area during the transition.
      cleanupConsoleBridge();

      // Print the cancel message AFTER terminal regions are torn down so it
      // goes to normal stdout instead of being routed through writeAbove.
      if (canceledByUser && !host.useInkRenderer) {
        console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
      }

      // Ensure the cursor is on a fresh blank line after cleanup so the next
      // prompt box doesn't overwrite the last output row.
      if (process.stdout.isTTY && !host.useInkRenderer) {
        process.stdout.write('\n');
      }

      // Show completion summary (skip if using Ink - it handles this via completionStats)
      if (host.taskStartedAt && !canceledByUser && !host.useInkRenderer) {
        host.printCompletionSummary(keepPersistentInputForNextTurn);
      }

      // Accumulate exact provider-reported session usage only when the whole turn reported usage.
      const completedTurnUsage = readCompletedTurnUsage(host);
      if (isActualTurnUsage(completedTurnUsage) && !host.currentTurnHadUnavailableUsage) {
        host.sessionActualTokensUsed += completedTurnUsage.totalTokens;
      } else {
        host.sessionTokenUsageUnavailable = true;
      }
      host.lastTurnActualUsage = completedTurnUsage;
      host.sessionTokensUsed = host.sessionActualTokensUsed;

      try {
        const turnTokens = isActualTurnUsage(completedTurnUsage) && !host.currentTurnHadUnavailableUsage
          ? completedTurnUsage.totalTokens
          : 0;
        await new GoalManager(host.runtime.workspaceRoot).recordTurnUsage({ tokensUsed: turnTokens });
      } catch {
        // Goal accounting is best-effort and must never mask the turn result.
      }

      if (!host.runtime.isCommandMode && !host.runtime.options?.prompt) {
        host.scheduleTurnMemoryReflection(success && !canceledByUser);
      }

      host.taskStartedAt = null;
      host.isInstructionActive = false;
      host.activeAbortController = null;
      host.clearExplorationLog();
    }
    return success;
  }
}
