/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../src/core/conversationManager.js';
import type { LLMMessage } from '../src/types.js';

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

  it('removes specific message indices in chronological order', () => {
    const removed = manager.removeIndices([4, 2]);

    expect(removed.map((msg) => msg.content)).toEqual(['assistant-old', 'assistant-new']);
    expect(manager.history().map((msg) => msg.content)).toEqual([
      'system prompt',
      'user-old',
      'user-new',
    ]);
  });

  it('keeps a native crop call in history until its result is recorded (#567, #555, #550)', () => {
    manager.reset('system prompt');
    manager.addMessage({ role: 'user', content: 'Compact context and continue working.' });
    const pendingCall: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_crop',
        type: 'function',
        function: {
          name: 'smart_context_cropper',
          arguments: '{"crop_direction":"bottom","crop_amount":1}',
        },
      }],
    };
    manager.addMessage(pendingCall);

    expect(manager.cropHistory('bottom', 1)).toEqual([]);
    expect(manager.history()).toContain(pendingCall);
  });

  it('keeps all results of an unfinished parallel native tool turn together', () => {
    manager.reset('system prompt');
    manager.addMessage({ role: 'user', content: 'Read files and compact context.' });
    const pendingCall: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: ['call_read', 'call_crop'].map((id) => ({
        id,
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      })),
    };
    const firstResult: LLMMessage = { role: 'tool', tool_call_id: 'call_read', content: 'file content' };
    manager.addMessage(pendingCall);
    manager.addMessage(firstResult);

    expect(manager.cropHistory('bottom', 10)).toEqual([]);
    expect(manager.history()).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Read files and compact context.' },
      pendingCall,
      firstResult,
    ]);
  });

  it.each(['top', 'bottom'] as const)('crops a completed native exchange coherently from the %s', (direction) => {
    manager.reset('system prompt');
    const completedCall: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_read',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      }],
    };
    const completedResult: LLMMessage = { role: 'tool', tool_call_id: 'call_read', content: 'file content' };
    manager.addMessage(completedCall);
    manager.addMessage(completedResult);
    manager.addMessage({ role: 'user', content: 'Continue.' });

    expect(manager.cropHistory(direction, 1)).toEqual([completedCall, completedResult]);
    expect(manager.history()).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Continue.' },
    ]);
  });

  it('preserves pending sibling results when the provider reuses a tool call ID across turns', () => {
    manager.reset('system prompt');
    const oldAssistant: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: 'call_read',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      }],
    };
    const oldResult: LLMMessage = { role: 'tool', tool_call_id: 'call_read', content: 'old file content' };
    const pendingAssistant: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: ['call_read', 'call_crop'].map((id) => ({
        id,
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      })),
    };
    const currentResult: LLMMessage = { role: 'tool', tool_call_id: 'call_read', content: 'new file content' };
    manager.addMessage(oldAssistant);
    manager.addMessage(oldResult);
    manager.addMessage({ role: 'user', content: 'Continue.' });
    manager.addMessage(pendingAssistant);
    manager.addMessage(currentResult);

    expect(manager.cropHistory('bottom', 1)).toEqual([oldAssistant, oldResult]);
    expect(manager.history()).toContain(pendingAssistant);
    expect(manager.history()).toContain(currentResult);
  });

  it('does not use a later exchange result to complete an older pending call with the same ID', () => {
    manager.reset('system prompt');
    const pendingAssistant: LLMMessage = {
      role: 'assistant',
      content: 'Earlier pending call',
      tool_calls: [{
        id: 'call_read',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      }],
    };
    manager.addMessage(pendingAssistant);
    manager.addMessage({ role: 'user', content: 'Read the file again.' });
    manager.addMessage({ ...pendingAssistant, content: 'Latest completed call' });
    manager.addMessage({ role: 'tool', tool_call_id: 'call_read', content: 'Latest file content' });

    expect(manager.cropHistory('top', 1)).toEqual([]);
    expect(manager.history()).toContain(pendingAssistant);
  });
});
