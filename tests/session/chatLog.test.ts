/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildSessionChatLog } from '../../src/session/chatLog.js';
import type { SessionMessage } from '../../src/session/types.js';

const timestamp = '2026-11-19T04:16:00.000Z';
const NARRATION = 'I need to understand the full build pipeline before implementing. Let me read the key sections of the build script and the release workflow to understand how targets, signing, and publishing work.';

const user = (content: string): SessionMessage => ({ role: 'user', content, timestamp });
const assistant = (content: string, toolCalls?: SessionMessage['toolCalls']): SessionMessage =>
  ({ role: 'assistant', content, timestamp, ...(toolCalls ? { toolCalls } : {}) });
const toolResult = (id: string): SessionMessage =>
  ({ role: 'tool', name: 'run_tool_script', tool_call_id: id, content: '{\n  "ok": true,\n  "result": "done"\n}', timestamp });
/** The shape native tool calls are persisted in (`conversation.jsonl`). */
const scriptCall = (id: string) => [{ id, tool: 'run_tool_script', args: { script: 'return "done";', description: 'Read build script CLI args and target handling' } }];

describe('buildSessionChatLog', () => {
  it('replays a turn the way it was shown live: narration that only introduced tool calls is left out', () => {
    // Reported session 446965e5…: the model repeated the same sentence before four identical tool
    // calls. Live, that narration is a transient preview; resume printed it once per iteration.
    const log = buildSessionChatLog([
      user('ok, give me the steps for doing step 1 and implement the 2 and 3 so we\'re ready'),
      assistant('I\'ll implement the winget publishing (step 2) and the MSIX Store target (step 3).', scriptCall('call-1')),
      toolResult('call-1'),
      assistant(NARRATION, scriptCall('call-2')),
      toolResult('call-2'),
      assistant(NARRATION, scriptCall('call-3')),
      toolResult('call-3'),
      assistant(NARRATION, scriptCall('call-4')),
      toolResult('call-4'),
      assistant(NARRATION),
      user('try agin my last mesasage'),
    ]);

    expect(log).toEqual([
      { role: 'user', content: 'ok, give me the steps for doing step 1 and implement the 2 and 3 so we\'re ready' },
      { role: 'assistant', content: NARRATION },
      { role: 'user', content: 'try agin my last mesasage' },
    ]);
  });

  it('keeps an assistant reply whose tool call list is empty or malformed', () => {
    expect(buildSessionChatLog([
      assistant('Answer with an empty call list.', []),
      { ...assistant('Answer with a malformed call list.'), toolCalls: 'none' as unknown as SessionMessage['toolCalls'] },
    ])).toEqual([
      { role: 'assistant', content: 'Answer with an empty call list.' },
      { role: 'assistant', content: 'Answer with a malformed call list.' },
    ]);
  });

  it('shows the final response of a JSON-protocol turn and hides its tool-calling steps', () => {
    expect(buildSessionChatLog([
      user('summarise'),
      assistant(JSON.stringify({ thought: 'reading', toolCalls: [{ tool: 'read_file', args: { path: 'a.ts' } }] })),
      assistant(JSON.stringify({ thought: 'done', finalResponse: 'The file exports one function.' })),
    ])).toEqual([
      { role: 'user', content: 'summarise' },
      { role: 'assistant', content: 'The file exports one function.' },
    ]);
  });

  it('returns nothing for an empty session and skips blank, tool and system messages', () => {
    expect(buildSessionChatLog([])).toEqual([]);
    expect(buildSessionChatLog([
      user('   '),
      assistant('  \n'),
      toolResult('call-1'),
      { role: 'system', content: '<system-reminder>context compacted</system-reminder>', timestamp },
    ])).toEqual([]);
  });
});
