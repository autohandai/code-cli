/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  TRANSCRIPT_MAX_MESSAGE_CHARS,
  TRANSCRIPT_MAX_MESSAGES,
  TRANSCRIPT_MAX_TOTAL_CHARS,
  buildFeedbackTranscript,
  redactSensitiveText,
} from '../../src/feedback/sessionTranscript.js';
import type { SessionMessage } from '../../src/session/types.js';

function message(role: SessionMessage['role'], content: string, extra: Partial<SessionMessage> = {}): SessionMessage {
  return { role, content, timestamp: '2026-10-03T10:00:00.000Z', ...extra };
}

describe('buildFeedbackTranscript', () => {
  it('returns an empty transcript for a missing or empty session', () => {
    expect(buildFeedbackTranscript(undefined)).toEqual({ messageCount: 0, truncated: false, messages: [] });
    expect(buildFeedbackTranscript([], { sessionId: 'session-1' })).toEqual({
      sessionId: 'session-1',
      messageCount: 0,
      truncated: false,
      messages: [],
    });
  });

  it('keeps the conversation in order with roles, timestamps and tool names', () => {
    const transcript = buildFeedbackTranscript([
      message('user', 'fix the login bug'),
      message('assistant', 'Reading the handler.', {
        toolCalls: [{ function: { name: 'read_file', arguments: '{"path":"src/login.ts"}' } }],
      }),
      message('tool', 'export function login() {}', { name: 'read_file' }),
      message('assistant', 'Done.'),
    ], { sessionId: 'session-2' });

    expect(transcript.sessionId).toBe('session-2');
    expect(transcript.messageCount).toBe(4);
    expect(transcript.truncated).toBe(false);
    expect(transcript.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(transcript.messages[0]).toEqual({
      role: 'user',
      content: 'fix the login bug',
      timestamp: '2026-10-03T10:00:00.000Z',
    });
    expect(transcript.messages[1]?.content).toContain('Reading the handler.');
    expect(transcript.messages[1]?.content).toContain('[tool calls: read_file]');
    expect(transcript.messages[2]?.name).toBe('read_file');
  });

  it('records the tool calls of an assistant message that has no text', () => {
    const transcript = buildFeedbackTranscript([
      message('assistant', '', { toolCalls: [{ function: { name: 'run_command' } }, { name: 'write_file' }, null] }),
    ]);

    expect(transcript.messages).toEqual([
      { role: 'assistant', content: '[tool calls: run_command, write_file]', timestamp: '2026-10-03T10:00:00.000Z' },
    ]);
  });

  it('drops system prompts and strips system-injected blocks from real content', () => {
    const transcript = buildFeedbackTranscript([
      message('system', 'You are Autohand. Secret internal prompt.'),
      message('user', '<system-reminder>internal rules</system-reminder>\nwhy is the build red?'),
      message('user', '<environment_context>\n<cwd>/repo</cwd>\n</environment_context>'),
      message('user', '<user_instructions>be terse</user_instructions>'),
    ]);

    expect(transcript.messageCount).toBe(4);
    expect(transcript.messages).toEqual([
      { role: 'user', content: 'why is the build red?', timestamp: '2026-10-03T10:00:00.000Z' },
    ]);
    expect(JSON.stringify(transcript)).not.toContain('internal');
  });

  it('skips malformed entries instead of throwing', () => {
    const malformed = [
      null,
      'not a message',
      { role: 'user' },
      { role: 'robot', content: 'unknown role' },
      { role: 'user', content: 42 },
      { role: 'user', content: 'kept', timestamp: 7 },
    ] as unknown as SessionMessage[];

    const transcript = buildFeedbackTranscript(malformed);

    expect(transcript.messageCount).toBe(6);
    expect(transcript.messages).toEqual([{ role: 'user', content: 'kept' }]);
  });

  it('keeps only the most recent messages and flags the truncation', () => {
    const messages = Array.from({ length: TRANSCRIPT_MAX_MESSAGES + 5 }, (_, index) => message('user', `prompt ${index}`));

    const transcript = buildFeedbackTranscript(messages);

    expect(transcript.messageCount).toBe(TRANSCRIPT_MAX_MESSAGES + 5);
    expect(transcript.truncated).toBe(true);
    expect(transcript.messages).toHaveLength(TRANSCRIPT_MAX_MESSAGES);
    expect(transcript.messages[0]?.content).toBe('prompt 5');
    expect(transcript.messages.at(-1)?.content).toBe(`prompt ${TRANSCRIPT_MAX_MESSAGES + 4}`);
  });

  it('cuts an oversized message at the limit and says how much was removed', () => {
    const transcript = buildFeedbackTranscript([message('tool', 'x'.repeat(TRANSCRIPT_MAX_MESSAGE_CHARS + 250))]);

    const content = transcript.messages[0]?.content ?? '';
    expect(transcript.truncated).toBe(true);
    expect(content.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_MESSAGE_CHARS);
    expect(content).toMatch(/… \[truncated \d+ chars\]$/u);
  });

  it('leaves a message exactly at the limit untouched', () => {
    const transcript = buildFeedbackTranscript([message('user', 'y'.repeat(TRANSCRIPT_MAX_MESSAGE_CHARS))]);

    expect(transcript.truncated).toBe(false);
    expect(transcript.messages[0]?.content).toHaveLength(TRANSCRIPT_MAX_MESSAGE_CHARS);
  });

  it('drops the oldest messages once the total budget is exhausted', () => {
    const count = Math.ceil(TRANSCRIPT_MAX_TOTAL_CHARS / TRANSCRIPT_MAX_MESSAGE_CHARS) + 3;
    const messages = Array.from({ length: count }, (_, index) =>
      message('tool', `${index}:`.padEnd(TRANSCRIPT_MAX_MESSAGE_CHARS, 'z')));

    const transcript = buildFeedbackTranscript(messages);
    const total = transcript.messages.reduce((sum, entry) => sum + entry.content.length, 0);

    expect(transcript.truncated).toBe(true);
    expect(total).toBeLessThanOrEqual(TRANSCRIPT_MAX_TOTAL_CHARS);
    expect(transcript.messages.at(-1)?.content.startsWith(`${count - 1}:`)).toBe(true);
    expect(transcript.messages[0]?.content.startsWith('0:')).toBe(false);
  });

  it('redacts secrets and the home directory from every message', () => {
    const transcript = buildFeedbackTranscript([
      message('user', `my key is sk-abcdefghijklmnop1234 in ${os.homedir()}/project/.env`),
      message('tool', 'Authorization: Bearer abc.def.ghi-123', { name: 'run_command' }),
    ]);

    const serialized = JSON.stringify(transcript);
    expect(serialized).not.toContain('sk-abcdefghijklmnop1234');
    expect(serialized).not.toContain('abc.def.ghi-123');
    expect(serialized).not.toContain(os.homedir());
    expect(transcript.messages[0]?.content).toContain('~/project/.env');
  });
});

describe('redactSensitiveText', () => {
  it.each([
    ['sk-or-v1-abcdefghijklmnopqrstuvwxyz012345', 'OpenRouter key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'GitHub token'],
    ['github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz', 'GitHub fine-grained token'],
    ['xoxb-synthetic-redaction-fixture', 'Slack token'],
    ['ahc_abcdefghijklmnopqrstuvwxyz', 'Autohand token'],
    ['AKIAIOSFODNN7EXAMPLE', 'AWS access key id'],
  ])('redacts %s (%s)', (secret) => {
    const redacted = redactSensitiveText(`value=${secret} trailing`);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('trailing');
  });

  it('redacts secret-looking assignments and query parameters but keeps the key name', () => {
    expect(redactSensitiveText('OPENAI_API_KEY=abc123secretvalue')).toBe('OPENAI_API_KEY=[REDACTED]');
    expect(redactSensitiveText('"password": "hunter2hunter2"')).toBe('"password": "[REDACTED]"');
    expect(redactSensitiveText('https://x.dev/cb?code=abcdef&token=xyz987&page=2'))
      .toBe('https://x.dev/cb?code=[REDACTED]&token=[REDACTED]&page=2');
  });

  it('redacts private key blocks', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';

    expect(redactSensitiveText(`before\n${key}\nafter`)).toBe('before\n[REDACTED PRIVATE KEY]\nafter');
  });

  it('replaces other users\' home directories on every platform', () => {
    expect(redactSensitiveText('/Users/alice/app and /home/bob/app')).toBe('~/app and ~/app');
    expect(redactSensitiveText('C:\\Users\\carol\\app')).toBe('~\\app');
  });

  it('leaves ordinary text alone', () => {
    const text = 'The task-list key is ordered; see sketch.md and token budgets.';

    expect(redactSensitiveText(text)).toBe(text);
  });
});
