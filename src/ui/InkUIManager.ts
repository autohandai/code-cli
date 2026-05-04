/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * InkUIManager - UIManager implementation that wraps InkRenderer.
 * Provides the unified UIManager interface for the Ink-based TUI.
 */

import { BaseUIManager, type UIManager } from './UIManager.js';
import { InkRenderer, type InkRendererOptions } from './ink/InkRenderer.js';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { SkillMentionInfo } from './mentionFilter.js';

export interface InkUIManagerOptions {
  onInstruction: (text: string) => void;
  onEscape: () => void;
  onCtrlC: () => void;
  enableQueueInput?: boolean;
  onImageDetected?: (data: Buffer, mimeType: string, filename?: string) => number;
  filesProvider?: () => string[];
  slashCommands?: SlashCommand[];
  skillsProvider?: () => SkillMentionInfo[];
}

export class InkUIManager extends BaseUIManager implements UIManager {
  private inkRenderer: InkRenderer | null = null;
  private readonly options: InkUIManagerOptions;
  private inputWaiter: ((input: string) => void) | null = null;
  private providerModel: { provider: string; model: string } | null = null;

  constructor(options: InkUIManagerOptions) {
    super();
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.inkRenderer) {
      return;
    }

    const rendererOptions: InkRendererOptions = {
      ...this.options,
      onInstruction: (text: string) => {
        this.enqueueInstruction(text);
        if (this.inputWaiter) {
          const waiter = this.inputWaiter;
          this.inputWaiter = null;
          waiter(text);
        }
      },
    };

    this.inkRenderer = new InkRenderer(rendererOptions);
    if (this.providerModel) {
      this.inkRenderer.setProviderModel(this.providerModel.provider, this.providerModel.model);
    }
    this.inkRenderer.start();
  }

  async stop(): Promise<void> {
    if (this.inkRenderer) {
      this.inkRenderer.stop();
      this.inkRenderer = null;
    }
    this.inputWaiter = null;
  }

  async pause(): Promise<void> {
    this.inkRenderer?.pause();
  }

  async resume(): Promise<void> {
    await this.inkRenderer?.resume();
  }

  setStatus(status: string): void {
    this.inkRenderer?.setStatus(status);
  }

  setWorking(working: boolean, message?: string): void {
    this.inkRenderer?.setWorking(working, message ?? '');
    this.isWorking = working;
  }

  setProviderModel(provider: string, model: string): void {
    this.providerModel = { provider, model };
    this.inkRenderer?.setProviderModel(provider, model);
  }

  setFinalResponse(response: string): void {
    this.inkRenderer?.setFinalResponse(response);
    this.finalResponse = response;
  }

  addUserMessage(text: string): void {
    this.inkRenderer?.addUserMessage(text);
  }

  addToolOutput(tool: string, success: boolean, output: string): void {
    this.inkRenderer?.addToolOutput(tool, success, output);
  }

  getCurrentInput(): string {
    return this.inkRenderer?.getState().currentInput ?? '';
  }

  clearInput(): void {
    this.inkRenderer?.clearInput();
  }

  focusInput?(): void {}

  hasQueuedInstructions(): boolean {
    return this.inkRenderer?.hasQueuedInstructions() ?? this.queue.length > 0;
  }

  dequeueInstruction(): string | null {
    return this.inkRenderer?.dequeueInstruction() ?? super.dequeueInstruction();
  }

  getQueueCount(): number {
    return this.inkRenderer?.getQueueCount() ?? this.queue.length;
  }

  enqueueInstruction(instruction: string): void {
    if (this.inkRenderer) {
      this.inkRenderer.addQueuedInstruction(instruction);
    } else {
      super.enqueueInstruction(instruction);
    }
  }

  async waitForInput(): Promise<string> {
    if (this.inkRenderer?.hasQueuedInstructions()) {
      return this.inkRenderer.dequeueInstruction()!;
    }

    return new Promise((resolve) => {
      this.inputWaiter = resolve;
    });
  }

  isRunning(): boolean {
    return this.inkRenderer?.isRunning() ?? false;
  }

  getInkRenderer(): InkRenderer | null {
    return this.inkRenderer;
  }
}

export function createInkUIManager(options: InkUIManagerOptions): InkUIManager {
  return new InkUIManager(options);
}
