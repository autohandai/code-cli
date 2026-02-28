/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';

/**
 * Access the private parseAssistantReactPayload method for testing.
 * This is the same pattern used in agent.startup-ui.spec.ts.
 */
function createMinimalAgent(): any {
  const agent = Object.create(AutohandAgent.prototype);
  return agent;
}

describe('parseAssistantReactPayload thought extraction', () => {
  it('extracts thought from JSON {"thought": "..."} structure', () => {
    const agent = createMinimalAgent();
    const raw = '{"thought": "The user greeted me with hey there, let me think about how to respond."}';
    const result = agent.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('The user greeted me with hey there, let me think about how to respond.');
  });

  it('extracts thought and finalResponse from complete JSON payload', () => {
    const agent = createMinimalAgent();
    const raw = '{"thought": "Analyzing the request...", "finalResponse": "Here is the answer."}';
    const result = agent.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('Analyzing the request...');
    expect(result.finalResponse).toBe('Here is the answer.');
  });

  it('extracts thought with empty toolCalls and no finalResponse', () => {
    const agent = createMinimalAgent();
    const raw = '{"thought": "Let me consider this carefully.", "toolCalls": []}';
    const result = agent.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('Let me consider this carefully.');
    expect(result.toolCalls).toEqual([]);
    expect(result.finalResponse).toBeUndefined();
  });

  it('treats plain text as finalResponse (not JSON)', () => {
    const agent = createMinimalAgent();
    const raw = 'Hello! How can I help you today?';
    const result = agent.parseAssistantReactPayload(raw);

    expect(result.finalResponse).toBe('Hello! How can I help you today?');
    expect(result.thought).toBeUndefined();
  });

  it('handles malformed JSON by falling back to regex thought extraction', () => {
    const agent = createMinimalAgent();
    // Malformed JSON with complete quoted thought but missing closing brace
    const raw = '{"thought": "partial response here", "toolCalls": [';
    const result = agent.parseAssistantReactPayload(raw);

    // Should extract thought via regex fallback (requires complete quoted value)
    expect(result.thought).toBe('partial response here');
    expect(result.finalResponse).toBe('partial response here');
  });
});

describe('usedThoughtAsResponse logic', () => {
  it('thought becomes the response when no finalResponse, response, or toolCalls', () => {
    const agent = createMinimalAgent();
    const raw = '{"thought": "The user said hi. I should respond warmly."}';
    const payload = agent.parseAssistantReactPayload(raw);

    // Simulate the usedThoughtAsResponse logic from agent.ts
    const usedThoughtAsResponse = Boolean(payload.thought) &&
      !payload.finalResponse &&
      !payload.response &&
      !payload.toolCalls?.length;

    expect(usedThoughtAsResponse).toBe(true);

    // The raw response should be the thought text
    let rawResponse: string;
    if (payload.finalResponse) {
      rawResponse = payload.finalResponse;
    } else if (payload.response) {
      rawResponse = payload.response;
    } else if (!payload.toolCalls?.length && payload.thought) {
      rawResponse = payload.thought;
    } else {
      rawResponse = '';
    }

    expect(rawResponse).toBe('The user said hi. I should respond warmly.');
    // The thought is clean text, not raw JSON
    expect(rawResponse).not.toContain('{');
    expect(rawResponse).not.toContain('"thought"');
  });

  it('finalResponse takes priority over thought when both present', () => {
    const agent = createMinimalAgent();
    const raw = '{"thought": "thinking...", "finalResponse": "The actual answer."}';
    const payload = agent.parseAssistantReactPayload(raw);

    const usedThoughtAsResponse = Boolean(payload.thought) &&
      !payload.finalResponse &&
      !payload.response &&
      !payload.toolCalls?.length;

    expect(usedThoughtAsResponse).toBe(false);
    expect(payload.finalResponse).toBe('The actual answer.');
  });
});

describe('cleanupModelResponse does not mangle thought text', () => {
  it('preserves meaningful text content through cleanup', () => {
    const agent = createMinimalAgent();
    const thought = 'The user wants help with their code. Let me analyze the structure.';
    const cleaned = agent.cleanupModelResponse(thought);

    expect(cleaned).toBe(thought);
  });

  it('strips model artifacts but keeps core content', () => {
    const agent = createMinimalAgent();
    const thought = 'Here is my analysis of the problem.<end_of.turn>';
    const cleaned = agent.cleanupModelResponse(thought);

    expect(cleaned).toBe('Here is my analysis of the problem.');
  });

  it('strips closed <tool_call> XML blocks from response', () => {
    const agent = createMinimalAgent();
    const raw = 'Some response text <tool_call>{"name": "list_files", "arguments": {"path": "."}}</tool_call> more text';
    const cleaned = agent.cleanupModelResponse(raw);

    expect(cleaned).not.toContain('<tool_call>');
    expect(cleaned).not.toContain('</tool_call>');
    expect(cleaned).not.toContain('list_files');
    expect(cleaned).toContain('Some response text');
    expect(cleaned).toContain('more text');
  });

  it('strips unclosed <tool_call> tags at end of content', () => {
    const agent = createMinimalAgent();
    const raw = 'Response here } <tool_call>{"name": "list_files", "arguments": {"path": "."}}';
    const cleaned = agent.cleanupModelResponse(raw);

    expect(cleaned).not.toContain('<tool_call>');
    expect(cleaned).not.toContain('list_files');
    expect(cleaned).toContain('Response here');
  });

  it('strips multiple <tool_call> blocks from response', () => {
    const agent = createMinimalAgent();
    const raw = '} <tool_call>{"name": "read_file"}</tool_call>\n} <tool_call>{"name": "list_files"}</tool_call>';
    const cleaned = agent.cleanupModelResponse(raw);

    expect(cleaned).not.toContain('<tool_call>');
    expect(cleaned).not.toContain('read_file');
    expect(cleaned).not.toContain('list_files');
  });
});
