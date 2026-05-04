/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the "Reflect Before Acting" feature:
 * - `reflection` field extraction in parseAssistantReactPayload
 * - `reflection` field extraction in parseAssistantResponse (native tool calls)
 * - `reflection` field extraction in parseAssistantResponse (XML tool calls)
 * - Reflection loop guard logic
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';
import { ReactionParser } from '../../src/core/agent/ReactionParser.js';
import type { AssistantReactPayload } from '../../src/types.js';

/* ── Helpers ──────────────────────────────────────────────── */

function createParser(): ReactionParser {
  return new ReactionParser({ cleanupModelResponse: (text) => text });
}

function createMinimalAgent(): any {
  const agent = Object.create(AutohandAgent.prototype);
  agent.cleanupModelResponse = (text: string) => text;
  return agent;
}

/* ── Tests ────────────────────────────────────────────────── */

describe('parseAssistantReactPayload reflection extraction', () => {
  let parser: ReactionParser;

  beforeEach(() => {
    parser = createParser();
  });

  it('extracts reflection from JSON payload', () => {
    const raw = '{"thought": "I need to check the file", "reflection": "The file exists but is empty, so I need to create content", "toolCalls": [{"tool": "write_file", "args": {"path": "src/foo.ts"}}]}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('I need to check the file');
    expect(result.reflection).toBe('The file exists but is empty, so I need to create content');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('extracts reflection alongside finalResponse', () => {
    const raw = '{"thought": "Analyzed the code", "reflection": "The bug is in line 42 - off by one error", "finalResponse": "The bug is on line 42."}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('The bug is in line 42 - off by one error');
    expect(result.finalResponse).toBe('The bug is on line 42.');
  });

  it('returns undefined reflection when not present', () => {
    const raw = '{"thought": "Thinking...", "toolCalls": []}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from single tool call format', () => {
    const raw = '{"thought": "Need to read", "reflection": "Previous search found the file at src/bar.ts", "tool": "read_file", "args": {"path": "src/bar.ts"}}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('Previous search found the file at src/bar.ts');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].tool).toBe('read_file');
  });

  it('ignores non-string reflection values', () => {
    const raw = '{"thought": "Hmm", "reflection": 42, "finalResponse": "Done"}';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from malformed JSON via regex fallback', () => {
    // Malformed JSON (missing closing brace) with complete quoted thought and reflection
    const raw = '{"thought": "partial thought", "reflection": "partial reflection", "toolCalls": [';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.thought).toBe('partial thought');
    expect(result.reflection).toBe('partial reflection');
  });

  it('extracts reflection alone when thought is missing in malformed JSON', () => {
    // Malformed JSON with only reflection (unusual but possible)
    const raw = '{"reflection": "standalone reflection", "toolCalls": [';
    const result: AssistantReactPayload = parser.parseAssistantReactPayload(raw);

    expect(result.reflection).toBe('standalone reflection');
    expect(result.thought).toBeUndefined();
  });
});

describe('parseAssistantResponse reflection extraction (native tool calls)', () => {
  let parser: ReactionParser;

  beforeEach(() => {
    parser = createParser();
  });

  it('extracts reflection from JSON content with native tool calls', () => {
    const completion = {
      content: '{"thought": "Need to check", "reflection": "The config shows the port is 8080"}',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'read_file', arguments: '{"path": "config.json"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBe('Need to check');
    expect(result.reflection).toBe('The config shows the port is 8080');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('returns undefined reflection when content is plain text with native tool calls', () => {
    const completion = {
      content: 'Let me read the file',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'read_file', arguments: '{"path": "foo.ts"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBe('Let me read the file');
    expect(result.reflection).toBeUndefined();
  });

  it('extracts reflection from JSON content even without thought', () => {
    const completion = {
      content: '{"reflection": "The test passed, moving to next step"}',
      toolCalls: [{
        id: 'call_1',
        function: { name: 'run_command', arguments: '{"command": "npm test"}' }
      }]
    };
    const result: AssistantReactPayload = parser.parseAssistantResponse(completion);

    expect(result.thought).toBeUndefined();
    expect(result.reflection).toBe('The test passed, moving to next step');
  });
});

describe('Reflection loop guard logic', () => {
  it('triggers guard when model calls tools without reflection after tool results', () => {
    // Simulate the guard logic as it appears in runReactLoop
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'short', // < 50 chars, not substantive
      toolCalls: [{ tool: 'read_file', args: { path: 'bar.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(needsReflection).toBe(true);
    expect(hasReflection).toBe(false);
    expect(thoughtIsSubstantive).toBe(false);

    // Guard should trigger
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(1);
  });

  it('does not trigger guard when reflection field is present', () => {
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'short',
      reflection: 'The file contains the expected exports, I can now proceed to edit it',
      toolCalls: [{ tool: 'write_file', args: { path: 'bar.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(hasReflection).toBe(true);

    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(0);
  });

  it('does not trigger guard when thought is substantive (>50 chars)', () => {
    const needsReflection = true;
    let reflectionViolationCount = 0;

    const payload: AssistantReactPayload = {
      thought: 'The search results show that the function is defined in utils.ts and exported as a named export. I should read that file next to understand the implementation.',
      toolCalls: [{ tool: 'read_file', args: { path: 'utils.ts' } }]
    };

    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    expect(thoughtIsSubstantive).toBe(true);

    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
      }
    }

    expect(reflectionViolationCount).toBe(0);
  });

  it('clears needsReflection when reflection is satisfied', () => {
    let needsReflection = true;
    let reflectionViolationCount = 1;

    const payload: AssistantReactPayload = {
      reflection: 'The tool output confirms the file exists',
      toolCalls: [{ tool: 'write_file', args: { path: 'test.ts' } }]
    };

    // Reflection satisfied check
    if (needsReflection && (payload.reflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
      needsReflection = false;
      reflectionViolationCount = 0;
    }

    expect(needsReflection).toBe(false);
    expect(reflectionViolationCount).toBe(0);
  });

  it('clears needsReflection when model provides finalResponse without tool calls', () => {
    let needsReflection = true;

    const payload: AssistantReactPayload = {
      thought: 'I have enough information to answer',
      finalResponse: 'The answer is 42.'
    };

    if (needsReflection && (payload.reflection || (payload.thought?.length ?? 0) > 50 || !payload.toolCalls?.length)) {
      needsReflection = false;
    }

    expect(needsReflection).toBe(false);
  });

  it('allows tool calls through and resets state after violation limit exceeded', () => {
    let needsReflection = true;
    let reflectionViolationCount = 1;
    const reflectionViolationLimit = 2;

    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };
    const hasReflection = Boolean(payload.reflection);
    const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;

    // Simulate the guard's limit-exceeded branch
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      if (!hasReflection && !thoughtIsSubstantive) {
        reflectionViolationCount++;
        if (reflectionViolationCount < reflectionViolationLimit) {
          // block (not hit in this test)
        } else {
          // Limit exceeded: allow tool calls through and reset state
          needsReflection = false;
          reflectionViolationCount = 0;
        }
      }
    }

    // State should be reset to prevent unbounded counter growth in the same turn
    expect(needsReflection).toBe(false);
    expect(reflectionViolationCount).toBe(0);
  });

  it('does not trigger guard on first iteration (no prior tool results)', () => {
    const needsReflection = false; // Not set yet — no tool results received

    const payload: AssistantReactPayload = {
      toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }]
    };

    // Guard should NOT trigger because needsReflection is false
    let guardTriggered = false;
    if (needsReflection && payload.toolCalls && payload.toolCalls.length > 0) {
      const hasReflection = Boolean(payload.reflection);
      const thoughtIsSubstantive = (payload.thought?.length ?? 0) > 50;
      if (!hasReflection && !thoughtIsSubstantive) {
        guardTriggered = true;
      }
    }

    expect(guardTriggered).toBe(false);
  });
});

describe('System prompt includes reflection instructions', () => {
  it('buildSystemPrompt contains "Reflect Before Acting" section', async () => {
    const agent = createMinimalAgent();
    agent.runtime = {
      options: {},
      workspaceRoot: process.cwd(),
      config: {},
    };
    agent.toolManager = {
      listDefinitions: vi.fn(() => []),
    };
    agent.memoryManager = {
      getContextMemories: vi.fn(async () => ''),
    };
    agent.loadInstructionFiles = vi.fn(async () => []);
    agent.skillsRegistry = {
      listSkills: vi.fn(() => []),
      getActiveSkills: vi.fn(() => []),
    };
    agent.teamManager = {
      getTeam: vi.fn(() => null),
    };

    const prompt = await agent.buildSystemPrompt();
    expect(prompt).toContain('Reflect Before Acting');
    expect(prompt).toContain('reflection');
    expect(prompt).toContain('Reason + Reflect + Act');
  });
});
