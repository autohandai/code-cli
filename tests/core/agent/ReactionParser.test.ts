/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
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

  it('returns reflection from malformed JSON fallback', () => {
    const result = parser.parseAssistantReactPayload(
      '{"reflection": "standalone reflection", "toolCalls": [',
    );

    expect(result).toEqual({ reflection: 'standalone reflection' });
  });
});
