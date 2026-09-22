/** @license Apache-2.0 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import type { AgentAction } from '../../src/types.js';

describe('inspect_work_map tool', () => {
  it('is a read-only aggregate inspection tool with bounded filters', () => {
    const definition = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'inspect_work_map');
    expect(definition).toBeDefined();
    expect(definition?.requiresApproval).toBe(false);
    expect(definition?.parameters?.properties).toEqual(expect.objectContaining({
      since: expect.any(Object),
      agents: expect.any(Object),
    }));
    expect(definition?.parameters?.properties).not.toHaveProperty('workspace');
  });

  it('has a strongly typed action surface', () => {
    const action: AgentAction = {
      type: 'inspect_work_map',
      since: '30d',
      agents: ['autohand', 'codex'],
    };
    expect(action.type).toBe('inspect_work_map');
  });
});
