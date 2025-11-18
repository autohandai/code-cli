/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../src/core/conversationManager.js';

const manager = ConversationManager.getInstance();

function seedConversation(): void {
  manager.reset('system prompt');
  manager.addMessage({ role: 'user', content: 'user-old' });
  manager.addMessage({ role: 'assistant', content: 'assistant-old' });
  manager.addMessage({ role: 'user', content: 'user-new' });
  manager.addMessage({ role: 'assistant', content: 'assistant-new' });
}

describe('ConversationManager cropHistory', () => {
  beforeEach(() => {
    seedConversation();
  });

  it('crops top messages without removing the latest user entry', () => {
    const removed = manager.cropHistory('top', 1);

    expect(removed.map((msg) => msg.content)).toEqual(['user-old']);
    const history = manager.history();
    const lastUser = history.filter((msg) => msg.role === 'user').pop();
    expect(lastUser?.content).toBe('user-new');
  });

  it('crops bottom messages but protects the newest user message', () => {
    const removed = manager.cropHistory('bottom', 2);

    expect(removed.map((msg) => msg.content)).toEqual(['assistant-old', 'assistant-new']);
    const remaining = manager.history().map((msg) => msg.content);
    expect(remaining).toContain('user-new');
  });
});
