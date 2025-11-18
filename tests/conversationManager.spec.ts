/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../src/core/conversationManager.js';

describe('ConversationManager', () => {
  beforeEach(() => {
    const manager = ConversationManager.getInstance();
    manager.reset('system message');
  });

  it('behaves as a singleton', () => {
    const first = ConversationManager.getInstance();
    const second = ConversationManager.getInstance();
    expect(first).toBe(second);
  });

  it('maintains history with the system prompt and user messages', () => {
    const manager = ConversationManager.getInstance();
    manager.addMessage({ role: 'user', content: 'Hello' });
    const history = manager.history();
    expect(history[0].role).toBe('system');
    expect(history[1]).toEqual({ role: 'user', content: 'Hello' });
  });
});
