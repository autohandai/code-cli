/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AutohandAgent } from '../src/core/agent.js';

/**
 * Tests for XML <tool_call> parsing in assistant responses.
 *
 * Some LLM models (especially via OpenRouter) output tool calls as XML
 * in their text content instead of using the native tool calling API:
 *
 *   <tool_call>{"name": "write_file", "arguments": {"path": "...", "contents": "..."}}</tool_call>
 *
 * Without parsing, these render as raw text in the terminal and break
 * the session continuity.
 */

// Access private methods for unit testing
function getExtractXmlToolCalls(agent: AutohandAgent) {
  return (agent as any).extractXmlToolCalls.bind(agent);
}

function getParseAssistantResponse(agent: AutohandAgent) {
  return (agent as any).parseAssistantResponse.bind(agent);
}

describe('XML <tool_call> parsing', () => {
  let agent: AutohandAgent;
  let extractXmlToolCalls: (content: string) => any[];
  let parseAssistantResponse: (completion: any) => any;

  beforeEach(() => {
    // Create a minimal agent instance for testing private methods
    agent = Object.create(AutohandAgent.prototype);
    // Stub randomUUID used for generating IDs
    (agent as any).safeParseToolArgs = (json: string) => {
      try { return JSON.parse(json); } catch { return undefined; }
    };
    extractXmlToolCalls = getExtractXmlToolCalls(agent);
    parseAssistantResponse = getParseAssistantResponse(agent);
  });

  describe('extractXmlToolCalls', () => {
    it('should parse a single <tool_call> with name/arguments format', () => {
      const content = `<tool_call>{"name": "write_file", "arguments": {"path": "src/main.tsx", "contents": "hello"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args).toEqual({ path: 'src/main.tsx', contents: 'hello' });
      expect(calls[0].id).toBeDefined();
    });

    it('should parse multiple <tool_call> blocks in one response', () => {
      const content = [
        'I will create two files.',
        '<tool_call>{"name": "write_file", "arguments": {"path": "src/App.tsx", "contents": "app"}}</tool_call>',
        '<tool_call>{"name": "write_file", "arguments": {"path": "src/main.tsx", "contents": "main"}}</tool_call>',
      ].join('\n');

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(2);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args.path).toBe('src/App.tsx');
      expect(calls[1].tool).toBe('write_file');
      expect(calls[1].args.path).toBe('src/main.tsx');
    });

    it('should handle unicode escapes in JSON content', () => {
      // This matches the real-world bug: models output \u0027 for quotes, \u003c for <
      const content = `<tool_call>{"name": "write_file", "arguments": {"path": "src/App.tsx", "contents": "import React from \\u0027react\\u0027\\nimport { BrowserRouter } from \\u0027react-router-dom\\u0027"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args.contents).toContain("import React from 'react'");
      expect(calls[0].args.contents).toContain("import { BrowserRouter } from 'react-router-dom'");
    });

    it('should handle "tool" key instead of "name"', () => {
      const content = `<tool_call>{"tool": "read_file", "arguments": {"path": "package.json"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('read_file');
    });

    it('should handle top-level args when no "arguments" or "args" field', () => {
      const content = `<tool_call>{"name": "write_file", "path": "index.ts", "contents": "console.log('hi')"}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args).toEqual({ path: 'index.ts', contents: "console.log('hi')" });
    });

    it('should handle "args" field as alternative to "arguments"', () => {
      const content = `<tool_call>{"name": "run_command", "args": {"command": "npm test"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('run_command');
      expect(calls[0].args).toEqual({ command: 'npm test' });
    });

    it('should handle double-encoded JSON string arguments', () => {
      const inner = JSON.stringify({ path: 'test.ts', contents: 'ok' });
      const content = `<tool_call>{"name": "write_file", "arguments": ${JSON.stringify(inner)}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual({ path: 'test.ts', contents: 'ok' });
    });

    it('should return empty array for content without <tool_call> tags', () => {
      expect(extractXmlToolCalls('Just a normal response')).toEqual([]);
      expect(extractXmlToolCalls('')).toEqual([]);
      expect(extractXmlToolCalls('{"name": "write_file"}')).toEqual([]);
    });

    it('should skip malformed JSON inside <tool_call> tags', () => {
      const content = [
        '<tool_call>not json at all</tool_call>',
        '<tool_call>{"name": "write_file", "arguments": {"path": "ok.ts", "contents": "valid"}}</tool_call>',
      ].join('\n');

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
    });

    it('should skip entries with no name or tool field', () => {
      const content = `<tool_call>{"arguments": {"path": "test.ts"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toEqual([]);
    });

    it('should preserve explicit id from the tool call', () => {
      const content = `<tool_call>{"id": "call_abc123", "name": "read_file", "arguments": {"path": "x.ts"}}</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].id).toBe('call_abc123');
    });

    it('should handle truncated first <tool_call> followed by complete retry', () => {
      // Real-world bug: LLM starts a tool call, gets cut off mid-JSON,
      // then retries with a complete tool call. The first <tool_call> has no </tool_call>.
      const content = [
        '<tool_call>{"name": "write_file", "arguments": {"contents":"import React from \\u0027r',
        '<tool_call>{"name": "write_file", "arguments": {"contents": "full content", "path": "src/SearchBar.tsx"}}</tool_call>',
      ].join('\n');

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args.path).toBe('src/SearchBar.tsx');
      expect(calls[0].args.contents).toBe('full content');
    });

    it('should handle unclosed <tool_call> at end of content (no </tool_call>)', () => {
      // Some models never close the tag
      const content = `Some text\n<tool_call>\n{"name": "write_file", "arguments": {"path": "app.ts", "contents": "hello"}}`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args.path).toBe('app.ts');
    });

    it('should handle newline between <tool_call> tag and JSON', () => {
      const content = `<tool_call>\n{"name": "read_file", "arguments": {"path": "test.ts"}}\n</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('read_file');
    });

    it('should handle the exact real-world pattern from debug output', () => {
      // Exact pattern from the bug report: truncated first block + complete second block
      const content = `<tool_call>
{"name": "write_file", "arguments": {"contents":"import React, { useState } from \\u0027react\\u0027\\nimport { SearchFilters } from \\u0027../types\\u0027\\nimport { samplePies } f
<tool_call>
{"name": "write_file", "arguments": {"contents":"import React, { useState } from \\u0027react\\u0027\\n\\nexport function SearchBar() {\\n  return \\u003cdiv\\u003eSearch\\u003c/div\\u003e\\n}", "path":"src/components/SearchBar.tsx"}}
</tool_call>`;

      const calls = extractXmlToolCalls(content);

      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('write_file');
      expect(calls[0].args.path).toBe('src/components/SearchBar.tsx');
      expect(calls[0].args.contents).toContain('SearchBar');
    });
  });

  describe('parseAssistantResponse with XML tool calls', () => {
    it('should prefer native toolCalls over XML parsing', () => {
      const completion = {
        content: '<tool_call>{"name": "read_file", "arguments": {"path": "a.ts"}}</tool_call>',
        toolCalls: [{
          id: 'native_1',
          type: 'function' as const,
          function: { name: 'write_file', arguments: '{"path": "b.ts", "contents": "native"}' }
        }]
      };

      const payload = parseAssistantResponse(completion);

      expect(payload.toolCalls).toHaveLength(1);
      expect(payload.toolCalls[0].tool).toBe('write_file');
      expect(payload.toolCalls[0].id).toBe('native_1');
    });

    it('should extract thought text outside of <tool_call> blocks', () => {
      const completion = {
        content: 'I will create the file now.\n<tool_call>{"name": "write_file", "arguments": {"path": "app.ts", "contents": "ok"}}</tool_call>\nDone.',
        toolCalls: undefined
      };

      const payload = parseAssistantResponse(completion);

      expect(payload.toolCalls).toHaveLength(1);
      expect(payload.thought).toContain('I will create the file now.');
      expect(payload.thought).toContain('Done.');
      expect(payload.thought).not.toContain('<tool_call>');
    });

    it('should fall through to JSON parsing when no XML tool calls', () => {
      // Stub the parseAssistantReactPayload method
      (agent as any).parseAssistantReactPayload = (content: string) => ({
        finalResponse: content
      });
      (agent as any).extractJson = (_raw: string) => null;

      const completion = {
        content: 'Hello, how can I help?',
        toolCalls: undefined
      };

      const payload = parseAssistantResponse(completion);

      expect(payload.finalResponse).toBe('Hello, how can I help?');
      expect(payload.toolCalls).toBeUndefined();
    });
  });
});
