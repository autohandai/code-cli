/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { injectAgentContinuationMessage } from '../../../src/core/agent/InputTurnCoordinator.js';
import { ConversationManager } from '../../../src/core/conversationManager.js';

describe('injectAgentContinuationMessage', () => {
  it('skips recovery notes when the conversation has not been initialized yet', () => {
    const conversation = new ConversationManager();
    const addSystemNote = vi.spyOn(conversation, 'addSystemNote');

    expect(() => {
      injectAgentContinuationMessage(
        { conversation },
        new Error('provider failed during startup'),
        0
      );
    }).not.toThrow();
    expect(addSystemNote).not.toHaveBeenCalled();
  });

  it('adds recovery notes after the conversation is initialized', () => {
    const conversation = new ConversationManager();
    conversation.reset('system prompt');

    injectAgentContinuationMessage(
      { conversation },
      new Error('provider failed mid-turn'),
      0
    );

    expect(conversation.history()).toContainEqual({
      role: 'system',
      content: expect.stringContaining('[System Recovery]'),
    });
  });
});
