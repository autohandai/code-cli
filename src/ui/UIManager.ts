/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * UIManager - Abstraction for UI orchestration (Ink or Plain terminal).
 * Eliminates branching hell in agent.ts by providing a unified imperative API.
 * Handles queue management, modal pausing, status, working state, and input surface.
 * InkUIManager wraps InkRenderer; PlainUIManager wraps persistentInput + ora + terminal regions.
 */

import type { InkRenderer } from './ink/InkRenderer.js';

export interface UIManager {
  start(): Promise<void>;
  stop(): Promise<void>;

  pause(): Promise<void>;
  resume(): Promise<void>;

  setStatus(status: string): void;
  setWorking(working: boolean, message?: string): void;
  setProviderModel?(provider: string, model: string): void;
  setFinalResponse(response: string): void;
  addUserMessage(text: string): void;
  addToolOutput(tool: string, success: boolean, output: string): void;

  hasQueuedInstructions(): boolean;
  dequeueInstruction(): string | null;
  getQueueCount(): number;
  enqueueInstruction(instruction: string): void;

  getCurrentInput(): string;
  clearInput(): void;
  focusInput?(): void;

  runWithPausedSurface<T>(fn: () => Promise<T>): Promise<T>;

  waitForInput(): Promise<string>;

  writeAbove?(text: string): void;
  isUsingTerminalRegionsForActiveTurn?(): boolean;
  installPersistentConsoleBridge?(): void;
  getInkRenderer?(): InkRenderer | null;
}

export abstract class BaseUIManager implements UIManager {
  protected isWorking = false;
  protected status = '';
  protected finalResponse: string | null = null;
  protected queue: string[] = [];
  protected modalActive = false;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract pause(): Promise<void>;
  abstract resume(): Promise<void>;
  abstract setStatus(status: string): void;
  abstract setWorking(working: boolean, message?: string): void;
  abstract setFinalResponse(response: string): void;
  abstract addUserMessage(text: string): void;
  abstract addToolOutput(tool: string, success: boolean, output: string): void;
  abstract getCurrentInput(): string;
  abstract clearInput(): void;
  abstract waitForInput(): Promise<string>;

  hasQueuedInstructions(): boolean {
    return this.queue.length > 0;
  }

  dequeueInstruction(): string | null {
    return this.queue.shift() || null;
  }

  getQueueCount(): number {
    return this.queue.length;
  }

  enqueueInstruction(instruction: string): void {
    this.queue.push(instruction);
  }

  async runWithPausedSurface<T>(fn: () => Promise<T>): Promise<T> {
    await this.pause();
    this.modalActive = true;
    try {
      return await fn();
    } finally {
      this.modalActive = false;
      await this.resume();
    }
  }

  writeAbove?(_text: string): void {}

  isUsingTerminalRegionsForActiveTurn?(): boolean {
    return false;
  }

  installPersistentConsoleBridge?(): void {}

  getInkRenderer?(): InkRenderer | null {
    return null;
  }
}
