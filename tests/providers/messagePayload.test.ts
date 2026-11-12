import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOutboundMessages, normalizeToolCallHistory } from '../../src/providers/messagePayload.js';
import { CustomOpenAICompatibleProvider } from '../../src/providers/CustomOpenAICompatibleProvider.js';
import type { LLMToolCall, MultimodalMessage } from '../../src/types.js';

afterEach(() => { vi.restoreAllMocks(); });

function call(id: string, args: string): LLMToolCall {
  return { id, type: 'function', function: { name: 'read_file', arguments: args } };
}

function damagedHistory(args: string): MultimodalMessage[] {
  return [
    { role: 'user', content: 'Inspect the files' },
    { role: 'assistant', content: '', tool_calls: [call('damaged-call', args)] },
    { role: 'tool', tool_call_id: 'damaged-call', content: 'The tool arguments were invalid; no action ran.' },
    { role: 'user', content: 'Continue using the valid observations' },
  ];
}

describe('malformed native tool history', () => {
  it('preserves opaque reasoning blocks and does not reserialize valid arguments', () => {
    const valid: MultimodalMessage = {
      role: 'assistant', content: '', tool_calls: [call('valid', '{ "path": "package.json" }')],
      reasoningBlocks: [{ type: 'reasoning', id: 'opaque-reasoning', encrypted_content: 'opaque-payload' }],
    };
    expect(normalizeToolCallHistory([valid])[0]).toBe(valid);
    const invalid: MultimodalMessage = { ...valid, tool_calls: [call('invalid', '{"path":"unfinished')] };
    const normalized = normalizeToolCallHistory([invalid]);
    expect(normalized[0]?.reasoningBlocks).toBe(valid.reasoningBlocks);
    expect(normalized[0]?.tool_calls).toBeUndefined();
    expect(normalizeToolCallHistory(normalized)).toEqual(normalized);
  });

  it.each(['{"path":"unfinished', '', 'null', '[]', '"string"'])(
    'does not replay %j as a native function call or invent executable arguments', args => {
      const history = damagedHistory(args);
      const before = structuredClone(history);
      const payload = normalizeOutboundMessages(history);
      expect(payload.some(message => message.tool_calls !== undefined)).toBe(false);
      expect(payload.some(message => message.role === 'tool')).toBe(false);
      expect(JSON.stringify(payload)).toContain('invalid');
      expect(JSON.stringify(payload)).toContain('no action ran');
      expect(history).toEqual(before);
    },
  );

  it('keeps valid call arguments exactly and places recovered observations after native results', () => {
    const validArguments = '{ "path": "package.json" }';
    const history: MultimodalMessage[] = [
      { role: 'user', content: 'Inspect the files' },
      { role: 'assistant', content: 'Inspecting', tool_calls: [
        call('valid-call', validArguments), call('invalid-call', '{"path":"unfinished'),
      ] },
      { role: 'tool', tool_call_id: 'invalid-call', content: 'Invalid arguments were rejected.' },
      { role: 'tool', tool_call_id: 'valid-call', content: 'Existing package information' },
      { role: 'user', content: 'Continue' },
    ];
    const payload = normalizeOutboundMessages(history);
    expect(payload.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'user', 'user']);
    expect(payload[1]?.tool_calls).toEqual([call('valid-call', validArguments)]);
    expect(payload[2]).toMatchObject({ role: 'tool', tool_call_id: 'valid-call' });
    expect(payload[3]?.content).toContain('Invalid arguments were rejected.');
  });

  it('repairs invalid argument history at the actual custom-provider request boundary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'Recovered' }, finish_reason: 'stop' }],
    })));
    const provider = new CustomOpenAICompatibleProvider({
      id: 'history-fixture', displayName: 'History Fixture', apiFormat: 'openai-compatible',
      baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKeyRequired: false,
    }, { maxRetries: 0 });
    await provider.complete({ messages: damagedHistory('{"path":"unterminated') });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<Record<string, unknown>> };
    expect(payload.messages.some(message => message.tool_calls !== undefined)).toBe(false);
    expect(JSON.stringify(payload.messages)).toContain('no action ran');
  });
});
