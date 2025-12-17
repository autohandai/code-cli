/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from '../src/core/conversationManager.js';
import { ToolManager } from '../src/core/toolManager.js';
import type { LLMMessage, LLMToolCall, ToolCallRequest } from '../src/types.js';

describe('Tool Call ID Handling', () => {
  describe('LLMMessage type support', () => {
    it('should support tool_call_id for tool messages', () => {
      const toolMessage: LLMMessage = {
        role: 'tool',
        content: 'Tool result',
        name: 'read_file',
        tool_call_id: 'call_abc123'
      };

      expect(toolMessage.tool_call_id).toBe('call_abc123');
      expect(toolMessage.role).toBe('tool');
    });

    it('should support tool_calls for assistant messages', () => {
      const toolCalls: LLMToolCall[] = [
        {
          id: 'call_abc123',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path": "src/index.ts"}'
          }
        }
      ];

      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: 'Let me read that file',
        tool_calls: toolCalls
      };

      expect(assistantMessage.tool_calls).toHaveLength(1);
      expect(assistantMessage.tool_calls?.[0].id).toBe('call_abc123');
    });
  });

  describe('ToolCallRequest type support', () => {
    it('should support id field for native function calling', () => {
      const toolCall: ToolCallRequest = {
        id: 'call_xyz789',
        tool: 'read_file',
        args: { path: 'src/index.ts' }
      };

      expect(toolCall.id).toBe('call_xyz789');
      expect(toolCall.tool).toBe('read_file');
    });

    it('should work without id for JSON-parsed tool calls', () => {
      const toolCall: ToolCallRequest = {
        tool: 'write_file',
        args: { path: 'test.ts', contents: 'test' }
      };

      expect(toolCall.id).toBeUndefined();
      expect(toolCall.tool).toBe('write_file');
    });
  });

  describe('ConversationManager with tool messages', () => {
    beforeEach(() => {
      const manager = ConversationManager.getInstance();
      manager.reset('You are a helpful assistant');
    });

    it('should store tool messages with tool_call_id', () => {
      const manager = ConversationManager.getInstance();

      // Add assistant message with tool calls
      const assistantMsg: LLMMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_test123',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"test.ts"}' }
        }]
      };
      manager.addMessage(assistantMsg);

      // Add tool response with matching ID
      const toolMsg: LLMMessage = {
        role: 'tool',
        name: 'read_file',
        content: 'file contents here',
        tool_call_id: 'call_test123'
      };
      manager.addMessage(toolMsg);

      const history = manager.history();
      expect(history).toHaveLength(3); // system + assistant + tool

      const lastMsg = history[2];
      expect(lastMsg.role).toBe('tool');
      expect(lastMsg.tool_call_id).toBe('call_test123');
      expect(lastMsg.content).toBe('file contents here');
    });

    it('should preserve tool_calls in assistant messages', () => {
      const manager = ConversationManager.getInstance();

      const toolCalls: LLMToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' }
        },
        {
          id: 'call_2',
          type: 'function',
          function: { name: 'write_file', arguments: '{"path":"b.ts","contents":"x"}' }
        }
      ];

      const assistantMsg: LLMMessage = {
        role: 'assistant',
        content: 'I will read and write files',
        tool_calls: toolCalls
      };
      manager.addMessage(assistantMsg);

      const history = manager.history();
      const assistantFromHistory = history[1];

      expect(assistantFromHistory.tool_calls).toHaveLength(2);
      expect(assistantFromHistory.tool_calls?.[0].id).toBe('call_1');
      expect(assistantFromHistory.tool_calls?.[1].id).toBe('call_2');
    });
  });

  describe('ToolManager execution with IDs', () => {
    it('should execute tools while preserving order for ID matching', async () => {
      const executor = vi.fn()
        .mockResolvedValueOnce('first result')
        .mockResolvedValueOnce('second result');
      const confirm = vi.fn().mockResolvedValue(true);

      const definitions = [
        { name: 'read_file' as const, description: 'read' },
        { name: 'write_file' as const, description: 'write' }
      ];

      const manager = new ToolManager({
        executor,
        confirmApproval: confirm,
        definitions: definitions as any
      });

      const toolCalls: ToolCallRequest[] = [
        { id: 'call_a', tool: 'read_file', args: { path: 'a.ts' } },
        { id: 'call_b', tool: 'write_file', args: { path: 'b.ts', contents: 'x' } }
      ];

      const results = await manager.execute(toolCalls);

      // Results should be in same order as calls for ID matching
      expect(results).toHaveLength(2);
      expect(results[0].tool).toBe('read_file');
      expect(results[0].output).toBe('first result');
      expect(results[1].tool).toBe('write_file');
      expect(results[1].output).toBe('second result');
    });
  });

  describe('Message format for API compliance', () => {
    it('should produce correct message format for OpenAI/OpenRouter', () => {
      // Simulate the message format that would be sent to the API
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Read the file' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_abc',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"test.ts"}' }
          }]
        },
        {
          role: 'tool',
          name: 'read_file',
          content: 'file contents',
          tool_call_id: 'call_abc'
        },
        { role: 'assistant', content: 'Here is the file content...' }
      ];

      // Verify structure
      expect(messages[2].tool_calls?.[0].id).toBe('call_abc');
      expect(messages[3].tool_call_id).toBe('call_abc');
      expect(messages[3].tool_call_id).toBe(messages[2].tool_calls?.[0].id);
    });

    it('should handle multiple tool calls in a single assistant message', () => {
      const assistantMsg: LLMMessage = {
        role: 'assistant',
        content: 'I need to perform multiple operations',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'search', arguments: '{}' } },
          { id: 'call_3', type: 'function', function: { name: 'list_tree', arguments: '{}' } }
        ]
      };

      const toolResponses: LLMMessage[] = [
        { role: 'tool', name: 'read_file', content: 'result 1', tool_call_id: 'call_1' },
        { role: 'tool', name: 'search', content: 'result 2', tool_call_id: 'call_2' },
        { role: 'tool', name: 'list_tree', content: 'result 3', tool_call_id: 'call_3' }
      ];

      // Each response should match its corresponding tool call
      expect(assistantMsg.tool_calls).toHaveLength(3);
      expect(toolResponses).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        expect(toolResponses[i].tool_call_id).toBe(assistantMsg.tool_calls?.[i].id);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle missing tool_call_id gracefully', () => {
      // Some providers (like llama.cpp) don't support native function calling
      const toolMsg: LLMMessage = {
        role: 'tool',
        name: 'read_file',
        content: 'result'
        // No tool_call_id
      };

      expect(toolMsg.tool_call_id).toBeUndefined();
    });

    it('should handle synthetic tool call IDs from Ollama', () => {
      // Ollama generates IDs like 'ollama-tool-{timestamp}-{index}'
      const syntheticId = `ollama-tool-${Date.now()}-0`;

      const toolCall: ToolCallRequest = {
        id: syntheticId,
        tool: 'read_file',
        args: { path: 'test.ts' }
      };

      expect(toolCall.id).toContain('ollama-tool-');
    });

    it('should handle empty tool calls array', () => {
      const assistantMsg: LLMMessage = {
        role: 'assistant',
        content: 'No tools needed',
        tool_calls: []
      };

      expect(assistantMsg.tool_calls).toHaveLength(0);
    });
  });
});
