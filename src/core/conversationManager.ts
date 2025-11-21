/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMMessage } from '../types.js';

export class ConversationManager {
  private static instance: ConversationManager | null = null;
  private messages: LLMMessage[] = [];
  private initialized = false;

  public constructor() { }

  static getInstance(): ConversationManager {
    if (!ConversationManager.instance) {
      ConversationManager.instance = new ConversationManager();
    }
    return ConversationManager.instance;
  }

  reset(systemPrompt: string): void {
    this.messages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  addMessage(message: LLMMessage): void {
    if (!this.initialized) {
      throw new Error('ConversationManager must be initialized with a system prompt before adding messages.');
    }
    this.messages.push(message);
  }

  history(): LLMMessage[] {
    return [...this.messages];
  }

  cropHistory(direction: 'top' | 'bottom', amount: number): LLMMessage[] {
    if (!this.initialized || amount <= 0 || this.messages.length <= 1) {
      return [];
    }
    const lastUserIndex = this.findLastUserIndex();
    if (lastUserIndex <= 0) {
      return [];
    }

    if (direction === 'top') {
      const removable = Math.max(0, lastUserIndex - 1);
      const removeCount = Math.min(removable, Math.floor(amount));
      if (!removeCount) {
        return [];
      }
      return this.messages.splice(1, removeCount);
    }

    const toRemove: number[] = [];
    for (let i = this.messages.length - 1; i >= 1 && toRemove.length < amount; i -= 1) {
      if (i === lastUserIndex) {
        continue;
      }
      toRemove.push(i);
    }
    if (!toRemove.length) {
      return [];
    }
    toRemove.sort((a, b) => a - b);
    const removed: LLMMessage[] = [];
    for (let i = toRemove.length - 1; i >= 0; i -= 1) {
      const index = toRemove[i];
      const [message] = this.messages.splice(index, 1);
      removed.unshift(message);
    }
    return removed;
  }

  addSystemNote(content: string): void {
    if (!this.initialized) {
      throw new Error('ConversationManager must be initialized before adding summaries.');
    }
    this.messages.push({ role: 'system', content });
  }

  private findLastUserIndex(): number {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }
}
