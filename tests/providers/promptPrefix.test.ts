import { describe, expect, it } from 'vitest';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { normalizePromptRoles } from '../../src/providers/messagePayload.js';

describe('runtime context and cached prompt prefixes', () => {
  it('keeps replaceable goal context at the request tail even when created before the first user turn', () => {
    const conversation = new ConversationManager();
    conversation.reset('Stable policy');
    conversation.addSystemNote('[Goal] budget 100', '[Goal]');
    conversation.addMessage({ role: 'user', content: 'Continue work' });
    const first = normalizePromptRoles(conversation.history());
    conversation.addMessage({ role: 'assistant', content: 'Verified progress' });
    conversation.addSystemNote('[Goal] budget 90', '[Goal]');
    const second = normalizePromptRoles(conversation.history());
    expect(first[0]).toEqual({ role: 'system', content: 'Stable policy' });
    expect(second.slice(0, first.length - 1)).toEqual(first.slice(0, -1));
    expect(second.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('budget 90') });
    expect(second.filter(message => message.role === 'system')).toHaveLength(1);
  });

  it('never replaces the base policy when a context key appears in its instructions', () => {
    const conversation = new ConversationManager();
    conversation.reset('Preserve [Goal] instructions');
    conversation.addSystemNote('[Goal] current state', '[Goal]');
    expect(conversation.history()[0].content).toBe('Preserve [Goal] instructions');
  });
});
