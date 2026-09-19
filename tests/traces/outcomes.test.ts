import { describe, expect, it } from 'vitest';
import type { NormalizedTrace } from '../../src/traces/model.js';
import { deriveTraceOutcome } from '../../src/traces/outcomes.js';

function sample(messages: NormalizedTrace['messages'], status: NormalizedTrace['status'] = 'completed'): NormalizedTrace {
  return {
    schemaVersion: 1,
    id: 'trace-one',
    source: { harness: 'autohand', externalId: 'one', recordPath: '/tmp/one', fingerprint: 'one' },
    agent: { name: 'Autohand' },
    project: {},
    status,
    usage: { provenance: 'unavailable' },
    relationships: [],
    messages,
    provenance: {
      adapterVersion: 1,
      parsedAt: '2026-09-18T00:00:00.000Z',
      completeness: 'complete',
      warnings: [],
    },
  };
}

describe('deriveTraceOutcome', () => {
  it('marks verified work only from observed successful verification tool exits', () => {
    const outcome = deriveTraceOutcome(sample([{
      id: 'message-one',
      role: 'assistant',
      order: 0,
      usage: { provenance: 'unavailable' },
      parts: [
        { type: 'tool_call', name: 'write_file', callId: 'edit-1' },
        { type: 'tool_result', name: 'write_file', callId: 'edit-1', exitCode: 0 },
        { type: 'tool_call', name: 'run_command', callId: 'test-1', arguments: { command: 'bun test' } },
        { type: 'tool_result', name: 'run_command', callId: 'test-1', exitCode: 0, content: 'pass' },
      ],
    }]));

    expect(outcome).toEqual({
      state: 'verified',
      facts: ['files_changed', 'tests_passed'],
      confidence: 'high',
    });
  });

  it('does not treat success prose without an exit code as proof', () => {
    const outcome = deriveTraceOutcome(sample([{
      id: 'message-one',
      role: 'assistant',
      order: 0,
      usage: { provenance: 'unavailable' },
      parts: [
        { type: 'tool_call', name: 'run_command', callId: 'test-1', arguments: { command: 'bun test' } },
        { type: 'tool_result', name: 'run_command', callId: 'test-1', content: 'all tests passed' },
      ],
    }]));

    expect(outcome).toEqual({ state: 'completed_unverified', facts: [], confidence: 'medium' });
  });

  it('records observed failed verification and cancellation separately', () => {
    const failed = deriveTraceOutcome(sample([{
      id: 'message-one',
      role: 'assistant',
      order: 0,
      usage: { provenance: 'unavailable' },
      parts: [
        { type: 'tool_call', name: 'run_command', callId: 'test-1', arguments: { command: 'vitest run' } },
        { type: 'tool_result', name: 'run_command', callId: 'test-1', exitCode: 1, isError: true },
      ],
    }], 'failed'));
    const cancelled = deriveTraceOutcome(sample([], 'cancelled'));

    expect(failed).toEqual({
      state: 'failed',
      facts: ['tests_failed', 'tool_error'],
      confidence: 'high',
    });
    expect(cancelled).toEqual({
      state: 'cancelled',
      facts: ['user_cancelled'],
      confidence: 'high',
    });
  });
});
