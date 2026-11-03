import { describe, expect, it, vi } from 'vitest';
import { activateGoalAutoMode } from '../../../src/core/agent/GoalActivation.js';
import type { InteractionMode } from '../../../src/core/agent/InteractionModeController.js';

describe('goal activation permission transaction', () => {
  it('establishes automode from current permissions and can roll back the exact prior mode', () => {
    let mode: InteractionMode = 'plan';
    const set = vi.fn((next: InteractionMode) => { mode = next; });
    const rollback = activateGoalAutoMode({ getInteractionMode: () => mode, setInteractionMode: set, permissionManager: { getMode: () => 'interactive' } });
    expect(mode).toBe('automode'); rollback(); expect(mode).toBe('plan');
  });

  it('preserves restricted permissions and noninteractive execution', () => {
    for (const context of [{ permissionManager: { getMode: () => 'restricted' as const } }, { isNonInteractive: true }]) {
      const set = vi.fn(); const rollback = activateGoalAutoMode({ ...context, setInteractionMode: set });
      expect(set).not.toHaveBeenCalled(); rollback(); expect(set).not.toHaveBeenCalled();
    }
  });
});
