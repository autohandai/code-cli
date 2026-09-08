/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMMessage } from '../types.js';
import { findCoherentRemovalIndices } from './context/priority.js';

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

  removeIndices(indices: number[]): LLMMessage[] {
    if (!this.initialized || indices.length === 0 || this.messages.length <= 1) {
      return [];
    }

    const uniqueValidIndices = [...new Set(indices)]
      .filter((index) => index > 0 && index < this.messages.length)
      .sort((a, b) => a - b);

    if (uniqueValidIndices.length === 0) {
      return [];
    }

    const removed: LLMMessage[] = [];
    for (let i = uniqueValidIndices.length - 1; i >= 0; i -= 1) {
      const index = uniqueValidIndices[i];
      const [message] = this.messages.splice(index, 1);
      if (message) {
        removed.unshift(message);
      }
    }

    return removed;
  }

  cropHistory(direction: 'top' | 'bottom', amount: number): LLMMessage[] {
    if (!this.initialized || amount <= 0 || this.messages.length <= 1) {
      return [];
    }
    const lastUserIndex = this.findLastUserIndex();
    if (lastUserIndex <= 0) {
      return [];
    }

    const unmatchedToolResultIds = new Set<string>();
    const pendingAssistantIndices: number[] = [];
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      if (message.role === 'tool' && message.tool_call_id) {
        unmatchedToolResultIds.add(message.tool_call_id);
      } else if (message.role === 'assistant' && message.tool_calls?.length) {
        if (message.tool_calls.some((call) => !unmatchedToolResultIds.has(call.id))) {
          pendingAssistantIndices.push(index);
        }
        for (const call of message.tool_calls) {
          unmatchedToolResultIds.delete(call.id);
        }
      }
    }
    // A crop tool runs before its own result is appended. Keep that pending
    // assistant and any completed sibling results until the whole exchange ends.
    const protectedIndices = new Set([
      lastUserIndex,
      ...findCoherentRemovalIndices(this.messages, pendingAssistantIndices),
    ]);

    const toRemove: number[] = [];
    if (direction === 'top') {
      for (let index = 1; index < lastUserIndex && toRemove.length < Math.floor(amount); index += 1) {
        if (!protectedIndices.has(index)) toRemove.push(index);
      }
    } else {
      for (let index = this.messages.length - 1; index >= 1 && toRemove.length < Math.floor(amount); index -= 1) {
        if (!protectedIndices.has(index)) toRemove.push(index);
      }
    }
    return this.removeIndices(findCoherentRemovalIndices(this.messages, toRemove));
  }

  replaceMessage(index: number, message: LLMMessage): void {
    if (!this.initialized) {
      throw new Error('ConversationManager must be initialized before replacing messages.');
    }
    if (index >= 0 && index < this.messages.length) {
      this.messages[index] = message;
    }
  }

  /**
   * Add a system note to the conversation.
   * If `replaceKey` is provided, replaces an existing system note containing
   * that key instead of appending. This prevents accumulation of old context
   * summary notes that never get cleaned up.
   */
  addSystemNote(content: string, replaceKey?: string): void {
    if (!this.initialized) {
      throw new Error('ConversationManager must be initialized before adding summaries.');
    }
    if (replaceKey) {
      const idx = this.messages.findIndex(
        (m) => m.role === 'system' && m.content?.includes(replaceKey)
      );
      if (idx >= 0) {
        this.messages[idx] = { role: 'system', content };
        return;
      }
    }
    this.messages.push({ role: 'system', content });
  }

  /**
   * Removes the last user message and all subsequent messages (assistant responses, tool results)
   * This effectively undoes the last conversation turn.
   */
  removeLastTurn(): void {
    if (!this.initialized || this.messages.length <= 1) {
      return;
    }

    const lastUserIndex = this.findLastUserIndex();
    if (lastUserIndex <= 0) {
      return;
    }

    // Remove all messages from the last user message onwards
    this.messages = this.messages.slice(0, lastUserIndex);
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
