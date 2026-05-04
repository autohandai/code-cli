/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlainUIManager - UIManager implementation for plain terminal (non-Ink).
 * Wraps PersistentInput + ora spinner + terminal regions.
 */

import ora, { type Ora } from 'ora';
import { BaseUIManager, type UIManager } from './UIManager.js';
import { PersistentInput, type PersistentInputOptions } from './persistentInput.js';
import type { TerminalRegions } from './terminalRegions.js';

export interface PlainUIManagerOptions {
  workspaceRoot?: string;
  silentMode?: boolean;
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
  suggestionProvider?: () => string | undefined;
}

export class PlainUIManager extends BaseUIManager implements UIManager {
  private persistentInput: PersistentInput | null = null;
  private spinner: Ora | null = null;
  private readonly options: PlainUIManagerOptions;
  private inputWaiter: ((input: string) => void) | null = null;
  private statusText = '';

  constructor(options: PlainUIManagerOptions = {}) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.persistentInput) {
      return;
    }

    const persistentInputOptions: PersistentInputOptions = {
      workspaceRoot: this.options.workspaceRoot,
      silentMode: this.options.silentMode,
      resolveShellSuggestion: this.options.resolveShellSuggestion,
      suggestionProvider: this.options.suggestionProvider,
    };

    this.persistentInput = new PersistentInput(persistentInputOptions);
    this.persistentInput.on('queued', (text: string) => {
      this.enqueueInstruction(text);
      this.resolveInputWaiter(text);
    });
    this.persistentInput.on('immediate-command', (text: string) => {
      this.enqueueInstruction(text);
      this.resolveInputWaiter(text);
    });

    this.persistentInput.start();
  }

  async stop(): Promise<void> {
    if (this.persistentInput) {
      this.persistentInput.stop();
      this.persistentInput.removeAllListeners();
      this.persistentInput = null;
    }
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    this.inputWaiter = null;
  }

  async pause(): Promise<void> {
    this.persistentInput?.pause();
  }

  async resume(): Promise<void> {
    this.persistentInput?.resume();
  }

  setStatus(status: string): void {
    this.statusText = status;
    this.persistentInput?.setStatusLine(status);
    if (this.spinner) {
      this.spinner.text = status;
    }
  }

  setWorking(working: boolean, message?: string): void {
    this.isWorking = working;
    if (working) {
      if (!this.spinner) {
        this.spinner = ora({
          text: message ?? this.statusText,
          spinner: 'dots',
        }).start();
      } else {
        this.spinner.text = message ?? this.statusText;
        if (!this.spinner.isSpinning) {
          this.spinner.start();
        }
      }
      this.persistentInput?.setActivityLine(message ?? this.statusText);
    } else {
      this.spinner?.stop();
      this.persistentInput?.setActivityLine('');
    }
  }

  setFinalResponse(response: string): void {
    this.finalResponse = response;
    if (!this.isWorking) {
      console.log('\n' + response + '\n');
    }
  }

  addUserMessage(text: string): void {
    console.log('\n> ' + text + '\n');
  }

  addToolOutput(tool: string, _success: boolean, output: string): void {
    console.log(`\n[${tool}]\n${output}\n`);
  }

  getCurrentInput(): string {
    return this.persistentInput?.getCurrentInput() ?? '';
  }

  clearInput(): void {
    this.persistentInput?.setCurrentInput('');
  }

  focusInput?(): void {}

  hasQueuedInstructions(): boolean {
    return this.persistentInput?.hasQueued() ?? this.queue.length > 0;
  }

  dequeueInstruction(): string | null {
    if (this.persistentInput) {
      const msg = this.persistentInput.dequeue();
      return msg?.text ?? null;
    }
    return super.dequeueInstruction();
  }

  getQueueCount(): number {
    return this.persistentInput?.getQueueLength() ?? this.queue.length;
  }

  async runWithPausedSurface<T>(fn: () => Promise<T>): Promise<T> {
    this.persistentInput?.pauseForModal();
    this.modalActive = true;
    try {
      return await fn();
    } finally {
      this.modalActive = false;
      this.persistentInput?.resumeFromModal();
    }
  }

  async waitForInput(): Promise<string> {
    if (this.persistentInput?.hasQueued()) {
      return this.persistentInput.dequeue()?.text ?? '';
    }

    if (this.queue.length > 0) {
      return this.dequeueInstruction()!;
    }

    return new Promise((resolve) => {
      this.inputWaiter = resolve;
    });
  }

  writeAbove(text: string): void {
    const regions = (this.persistentInput as { regions?: TerminalRegions } | null)?.regions;
    regions?.writeAbove?.(text);
  }

  isUsingTerminalRegionsForActiveTurn(): boolean {
    return (this.persistentInput as { isActive?: boolean } | null)?.isActive ?? false;
  }

  installPersistentConsoleBridge(): void {}

  getPersistentInput(): PersistentInput | null {
    return this.persistentInput;
  }

  getSpinner(): Ora | null {
    return this.spinner;
  }

  private resolveInputWaiter(text: string): void {
    if (!this.inputWaiter) {
      return;
    }
    const waiter = this.inputWaiter;
    this.inputWaiter = null;
    waiter(text);
  }
}

export function createPlainUIManager(options?: PlainUIManagerOptions): PlainUIManager {
  return new PlainUIManager(options);
}
