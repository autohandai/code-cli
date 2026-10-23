import { describe, expect, it } from 'vitest';
import { parseWorkflowExecution } from '../../../src/modes/acp/workflowExecution.js';

describe('native workflow execution metadata', () => {
  it('keeps ordinary prompts unchanged and preserves review arguments', () => {
    expect(parseWorkflowExecution(undefined)).toBeUndefined();
    expect(parseWorkflowExecution({ type: 'review', arguments: 'changes --focus cancellation' })).toEqual({ type: 'review', arguments: 'changes --focus cancellation' });
  });
  it('accepts a goal with a stable execution identity', () => {
    expect(parseWorkflowExecution({ type: 'goal', executionId: 'run-1:node-2' })).toEqual({ type: 'goal', executionId: 'run-1:node-2' });
  });
  it.each([null, [], { type: 'goal', arguments: 'unsupported' }, { type: 'review' }, { type: 'review', arguments: 'x'.repeat(65537) }, { type: 'review', arguments: '', command: '/publish' }])('rejects malformed or unsupported execution metadata %#', value => {
    expect(() => parseWorkflowExecution(value)).toThrow();
  });
});
