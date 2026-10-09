import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentTurnContext, type AgentContextRuntimeHost } from '../../../src/core/agent/AgentContextRuntime.js';
import { ConversationManager } from '../../../src/core/conversationManager.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function hostFor(bare = false): Promise<AgentContextRuntimeHost> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-project-context-'));
  roots.push(workspaceRoot);
  return {
    runtime: { workspaceRoot, options: { bare } },
    ignoreFilter: { isIgnored: () => false },
    mentionResolver: { flush: () => null },
    skillsRegistry: { activateMentionedSkills: () => [], getSkill: () => null },
    memoryManager: {
      getContextMemories: async () => '',
      getSharedProjectContext: vi.fn().mockResolvedValueOnce('Shared project snapshot: use Vitest').mockResolvedValueOnce('Shared project snapshot: use Bun tests'),
    },
  } as unknown as AgentContextRuntimeHost;
}

describe('agent turn shared project memory', () => {
  it('awaits a fresh shared snapshot on each turn', async () => {
    const host = await hostFor();
    const conversation = new ConversationManager();
    conversation.reset('System instructions');
    host.conversation = conversation;
    const first = await buildAgentTurnContext(host, 'implement the repository tests');
    conversation.addSystemNote(first);
    const second = await buildAgentTurnContext(host, 'continue implementing the tests');
    expect(first).toContain('Shared project snapshot: use Vitest');
    expect(second).toContain('Shared project snapshot: use Bun tests');
    expect(second).not.toContain('Shared project snapshot: use Vitest');
    expect(conversation.history()[1]?.content).not.toContain('Shared project snapshot: use Vitest');
    expect(conversation.history()[1]?.content).toContain('Workspace:');
    expect(host.memoryManager.getSharedProjectContext).toHaveBeenCalledTimes(2);
  });

  it('does not read shared memory in bare mode', async () => {
    const host = await hostFor(true);
    expect(await buildAgentTurnContext(host, 'run the tests')).not.toContain('Shared project snapshot');
    expect(host.memoryManager.getSharedProjectContext).not.toHaveBeenCalled();
  });

  it('removes previous shared snapshots from bootstrap and turn notes while preserving private context', async () => {
    const host = await hostFor();
    const conversation = new ConversationManager();
    const previous = '<autohand_shared_project_memory>\nOld team decision\n</autohand_shared_project_memory>';
    conversation.reset(`System instructions\n${previous}\n## User Preferences\nPrivate formatting preference`);
    conversation.addSystemNote(`[Session Bootstrap]\n${previous}\nOther workspace notes`);
    conversation.addSystemNote(`Previous workspace context\n${previous}`);
    conversation.addMessage({ role: 'user', content: 'My previous request' });
    host.conversation = conversation;
    const context = await buildAgentTurnContext(host, 'implement the tests');
    const history = conversation.history();
    expect(history.filter((message) => message.role === 'system').map((message) => message.content).join('\n')).not.toContain('Old team decision');
    expect(history[0]?.content).toContain('Private formatting preference');
    expect(history[1]?.content).toContain('Other workspace notes');
    expect(history[2]?.content).toContain('Previous workspace context');
    expect(history[3]?.content).toBe('My previous request');
    expect(context).toContain('Shared project snapshot: use Vitest');
  });

  it('removes shared notes when disconnected and preserves historic tool and assistant messages', async () => {
    const host = await hostFor();
    const conversation = new ConversationManager();
    conversation.reset('System instructions');
    conversation.addSystemNote('Local workspace\n<autohand_shared_project_memory>\nTeam A decision\n</autohand_shared_project_memory>');
    conversation.addMessage({ role: 'assistant', content: 'Historical answer using Team A decision' });
    conversation.addMessage({ role: 'tool', content: 'Historical tool output', tool_call_id: 'memory-call' });
    host.conversation = conversation;
    host.memoryManager.getSharedProjectContext = vi.fn().mockResolvedValue('');
    const context = await buildAgentTurnContext(host, 'continue locally');
    expect(context).not.toContain('Team A decision');
    expect(conversation.history()[1]?.content).toContain('Local workspace');
    expect(conversation.history()[1]?.content).not.toContain('Team A decision');
    expect(conversation.history()[2]?.content).toBe('Historical answer using Team A decision');
    expect(conversation.history()[3]?.content).toBe('Historical tool output');
  });

  it('strips shared reflection update lines while keeping personal update lines', async () => {
    const host = await hostFor();
    const conversation = new ConversationManager();
    conversation.reset('System instructions');
    conversation.addSystemNote('[Auto Memory Update]\n<autohand_shared_project_memory>\n- project: Previous team coding rule\n</autohand_shared_project_memory>\n- user: Keep explanations concise');
    host.conversation = conversation;
    host.memoryManager.getSharedProjectContext = vi.fn().mockResolvedValue('');
    await buildAgentTurnContext(host, 'continue in the current account');
    expect(conversation.history()[1]?.content).not.toContain('Previous team coding rule');
    expect(conversation.history()[1]?.content).toContain('[Auto Memory Update]');
    expect(conversation.history()[1]?.content).toContain('- user: Keep explanations concise');
  });
});
