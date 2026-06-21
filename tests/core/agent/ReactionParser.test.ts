/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { ReactionParser } from '../../../src/core/agent/ReactionParser.js';
import type { AssistantReactPayload, LLMResponse } from '../../../src/types.js';

describe('ReactionParser', () => {
  const parser = new ReactionParser({
    cleanupModelResponse: (content) => content.replace(/<end_of.turn>/gi, '').trim(),
  });

  it('extracts reflection from native tool-call JSON content', () => {
    const completion: LLMResponse = {
      id: 'resp-1',
      created: 1,
      content: '{"thought": "Need to check", "reflection": "The config points at port 8080"}',
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"config.json"}' },
        },
      ],
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result).toMatchObject<AssistantReactPayload>({
      thought: 'Need to check',
      reflection: 'The config points at port 8080',
      toolCalls: [{ id: 'call-1', tool: 'read_file', args: { path: 'config.json' } }],
    });
  });

  it('converts accidental native reflection tool calls into reflection text', () => {
    const completion: LLMResponse = {
      id: 'resp-reflection-tool',
      created: 4,
      content: '{"thought": "Need to inspect the previous result"}',
      toolCalls: [
        {
          id: 'call-reflection',
          type: 'function',
          function: {
            name: 'reflection',
            arguments: '{"reflection":"The previous output shows the config is missing."}',
          },
        },
        {
          id: 'call-read',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"package.json"}' },
        },
      ],
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The previous output shows the config is missing.');
    expect(result.toolCalls).toEqual([
      { id: 'call-read', tool: 'read_file', args: { path: 'package.json' } },
    ]);
  });

  it('preserves content reflection when native reflection tool calls are also present', () => {
    const completion: LLMResponse = {
      id: 'resp-native-reflection-precedence',
      created: 6,
      content: '{"reflection":"The content reflection should win."}',
      toolCalls: [
        {
          id: 'call-reflection',
          type: 'function',
          function: {
            name: 'reflection',
            arguments: '{"reflection":"The tool reflection should not overwrite it."}',
          },
        },
        {
          id: 'call-search',
          type: 'function',
          function: { name: 'tool_search', arguments: '{"query":"files"}' },
        },
      ],
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The content reflection should win.');
    expect(result.toolCalls).toEqual([
      { id: 'call-search', tool: 'tool_search', args: { query: 'files' } },
    ]);
  });

  it('removes native reflection-only tool calls before execution', () => {
    const completion: LLMResponse = {
      id: 'resp-native-reflection-only',
      created: 7,
      content: '',
      toolCalls: [
        {
          id: 'call-reflection',
          type: 'function',
          function: {
            name: 'reflection',
            arguments: '{"summary":"The last command confirmed the regression."}',
          },
        },
      ],
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The last command confirmed the regression.');
    expect(result.toolCalls).toEqual([]);
  });

  it('removes native reflection calls with invalid args instead of executing them', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const completion: LLMResponse = {
      id: 'resp-native-reflection-invalid-args',
      created: 8,
      content: '',
      toolCalls: [
        {
          id: 'call-reflection',
          type: 'function',
          function: {
            name: 'reflection',
            arguments: 'not-json',
          },
        },
      ],
      raw: {},
    };

    try {
      const result = parser.parseAssistantResponse(completion);

      expect(result.reflection).toBeUndefined();
      expect(result.toolCalls).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('parses XML tool calls and extracts surrounding JSON reflection', () => {
    const completion: LLMResponse = {
      id: 'resp-2',
      created: 2,
      content:
        '{"reflection":"The file needs an update"}\n<tool_call>{"name":"write_file","arguments":{"path":"src/foo.ts","contents":"ok"}}</tool_call>',
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The file needs an update');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'write_file',
        args: { path: 'src/foo.ts', contents: 'ok' },
      },
    ]);
  });

  it('converts accidental XML reflection tool calls into reflection text', () => {
    const completion: LLMResponse = {
      id: 'resp-reflection-xml-tool',
      created: 5,
      content:
        '<tool_call>{"name":"reflection","arguments":{"content":"The search result points to ReactLoopRunner."}}</tool_call>' +
        '<tool_call>{"name":"read_file","arguments":{"path":"src/core/agent/ReactLoopRunner.ts"}}</tool_call>',
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The search result points to ReactLoopRunner.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'read_file',
        args: { path: 'src/core/agent/ReactLoopRunner.ts' },
      },
    ]);
  });

  it('preserves surrounding XML reflection when reflection tool calls are also present', () => {
    const completion: LLMResponse = {
      id: 'resp-xml-reflection-precedence',
      created: 9,
      content:
        '{"reflection":"The surrounding reflection should win."}' +
        '<tool_call>{"name":"reflection","arguments":{"summary":"The tool reflection should not overwrite it."}}</tool_call>' +
        '<tool_call>{"name":"tools_registry"}</tool_call>',
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The surrounding reflection should win.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'tools_registry',
        args: undefined,
      },
    ]);
  });

  it('converts top-level XML reflection shorthand into reflection text', () => {
    const completion: LLMResponse = {
      id: 'resp-xml-reflection-shorthand',
      created: 10,
      content: '<tool_call>{"name":"reflection","message":"The XML shorthand has no arguments object."}</tool_call>',
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The XML shorthand has no arguments object.');
    expect(result.toolCalls).toEqual([]);
  });

  it('converts an unterminated XML reflection tool call into reflection text', () => {
    const completion: LLMResponse = {
      id: 'resp-xml-reflection-unterminated',
      created: 11,
      content: '<tool_call>{"name":"reflection","arguments":{"text":"The model stopped after opening the tool call."}}',
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The model stopped after opening the tool call.');
    expect(result.toolCalls).toEqual([]);
  });

  it('parses OpenRouter bracketed tool calls instead of rendering them as text', () => {
    const completion: LLMResponse = {
      id: 'resp-openrouter',
      created: 3,
      content: `[TOOL_CALL]
{tool => "git_diff", args => {
  --path "README.md"
}}
[/TOOL_CALL]`,
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.finalResponse).toBeUndefined();
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'git_diff',
        args: { path: 'README.md' },
      },
    ]);
  });

  it('converts OpenRouter bracketed reflection tool calls into reflection text', () => {
    const completion: LLMResponse = {
      id: 'resp-openrouter-reflection',
      created: 12,
      content: `[TOOL_CALL]
{tool => "reflection", args => {
  --message "The bracketed tool result explains the next step."
}}
[/TOOL_CALL]
[TOOL_CALL]
{tool => "tools_registry"}
[/TOOL_CALL]`,
      raw: {},
    };

    const result = parser.parseAssistantResponse(completion);

    expect(result.reflection).toBe('The bracketed tool result explains the next step.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'tools_registry',
        args: undefined,
      },
    ]);
  });

  it('preserves legacy bare single tool-call JSON top-level args', () => {
    const result = parser.parseAssistantReactPayload(
      '{"thought":"Need to inspect","tool":"read_file","path":"src/index.ts"}',
    );

    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'read_file',
        args: { thought: 'Need to inspect', path: 'src/index.ts' },
      },
    ]);
  });

  it('converts accidental JSON reflection tool calls into reflection text', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        thought: 'Need to continue after seeing the tool result',
        toolCalls: [
          {
            tool: 'reflection',
            args: { text: 'The failing command shows the missing export.' },
          },
          {
            tool: 'tools_registry',
          },
        ],
      }),
    );

    expect(result.reflection).toBe('The failing command shows the missing export.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'tools_registry',
        args: undefined,
      },
    ]);
  });

  it.each([
    ['reflection', { reflection: 'from reflection field' }, 'from reflection field'],
    ['content', { content: 'from content field' }, 'from content field'],
    ['text', { text: 'from text field' }, 'from text field'],
    ['message', { message: 'from message field' }, 'from message field'],
    ['summary', { summary: 'from summary field' }, 'from summary field'],
  ])('converts JSON reflection tool args using %s alias', (_field, args, expected) => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        toolCalls: [
          {
            tool: 'reflection',
            args,
          },
        ],
      }),
    );

    expect(result.reflection).toBe(expected);
    expect(result.toolCalls).toEqual([]);
  });

  it('converts single-tool JSON reflection shorthand into reflection text', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        tool: 'reflection',
        content: 'The top-level single-tool shape should become reflection metadata.',
      }),
    );

    expect(result.reflection).toBe('The top-level single-tool shape should become reflection metadata.');
    expect(result.toolCalls).toEqual([]);
  });

  it('preserves top-level JSON reflection when reflection tool calls are also present', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        reflection: 'The top-level reflection should win.',
        toolCalls: [
          {
            tool: 'reflection',
            args: { text: 'The tool reflection should not overwrite it.' },
          },
          {
            tool: 'tools_registry',
          },
        ],
      }),
    );

    expect(result.reflection).toBe('The top-level reflection should win.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'tools_registry',
        args: undefined,
      },
    ]);
  });

  it('keeps reflection-only JSON as metadata instead of a user response', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        reflection: 'The previous tool output already answers the next step.',
      }),
    );

    expect(result).toEqual({
      reflection: 'The previous tool output already answers the next step.',
      toolCalls: [],
      finalResponse: undefined,
      response: undefined,
      thought: undefined,
    });
  });

  it('converts JSON reflection tool calls with name and arguments aliases', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        toolCalls: [
          {
            name: 'reflection',
            arguments: '{"summary":"The alias format should still become reflection metadata."}',
          },
          {
            name: 'read_file',
            arguments: '{"path":"src/core/agent/ReactionParser.ts"}',
          },
        ],
      }),
    );

    expect(result.reflection).toBe('The alias format should still become reflection metadata.');
    expect(result.toolCalls).toEqual([
      {
        id: expect.any(String),
        tool: 'read_file',
        args: { path: 'src/core/agent/ReactionParser.ts' },
      },
    ]);
  });

  it('preserves finalResponse while removing JSON reflection-only tool calls', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        finalResponse: 'No more tools are needed.',
        toolCalls: [
          {
            tool: 'reflection',
            args: { summary: 'The answer can now be given.' },
          },
        ],
      }),
    );

    expect(result.reflection).toBe('The answer can now be given.');
    expect(result.toolCalls).toEqual([]);
    expect(result.finalResponse).toBe('No more tools are needed.');
  });

  it('treats mixed-case and padded reflection tool names as reflection metadata', () => {
    const result = parser.parseAssistantReactPayload(
      JSON.stringify({
        toolCalls: [
          {
            tool: ' Reflection ',
            args: { text: 'The tool name should be normalized before execution.' },
          },
        ],
      }),
    );

    expect(result.reflection).toBe('The tool name should be normalized before execution.');
    expect(result.toolCalls).toEqual([]);
  });

  it('returns reflection from malformed JSON fallback', () => {
    const result = parser.parseAssistantReactPayload(
      '{"reflection": "standalone reflection", "toolCalls": [',
    );

    expect(result).toEqual({ reflection: 'standalone reflection' });
  });
});
