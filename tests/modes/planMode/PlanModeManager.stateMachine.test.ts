/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { PLAN_MODE_PHASE, PlanModeManager } from '../../../src/modes/planMode/PlanModeManager.js';
import type { Plan } from '../../../src/modes/planMode/types.js';
import { reachableStates, StateMachine, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

const plan = (id = 'plan-1'): Plan => ({
  id,
  steps: [{ number: 1, description: 'Step', status: 'pending' }],
  rawText: '1. Step',
  createdAt: 1,
});

function executingManager(): PlanModeManager {
  const manager = new PlanModeManager();
  manager.enable();
  manager.setPlan(plan());
  manager.acceptPlan('auto_accept');
  return manager;
}

describe('PLAN_MODE_PHASE', () => {
  const events = ['accept', 'complete', 'replan'] as const;

  it('declares the allowed plan phase edges', () => {
    expect(PLAN_MODE_PHASE.initial).toBe('planning');
    expect(PLAN_MODE_PHASE.transitions).toEqual({
      planning: { accept: 'executing' },
      executing: { complete: 'completed', replan: 'planning' },
      completed: { replan: 'planning' },
    });
  });

  it('has no dead ends and every phase is reachable', () => {
    expect(terminalStates(PLAN_MODE_PHASE)).toEqual([]);
    expect(reachableStates(PLAN_MODE_PHASE)).toEqual(new Set(Object.keys(PLAN_MODE_PHASE.transitions)));
  });

  it.each([
    ['planning', 'complete'],
    ['planning', 'replan'],
    ['executing', 'accept'],
    ['completed', 'accept'],
    ['completed', 'complete'],
  ] as const)('rejects %s --%s', (from, event) => {
    const machine = new StateMachine(PLAN_MODE_PHASE, { initial: from });
    expect(machine.trySend(event)).toBe(false);
    expect(machine.state).toBe(from);
  });

  it('accepts exactly the declared edges on seeded random walks', () => {
    randomEventWalk(PLAN_MODE_PHASE, events, { seeds: 25, steps: 60 });
  });
});

describe('PlanModeManager phase guards', () => {
  it('does not start executing when plan mode is off', () => {
    const manager = new PlanModeManager();
    manager.setPlan(plan());
    const started = vi.fn();
    manager.on('execution:started', started);

    expect(() => manager.acceptPlan('auto_accept')).toThrow('Plan mode is not active');
    expect(() => manager.startExecution()).toThrow('Plan mode is not active');
    expect(manager.getPhase()).toBe('planning');
    expect(started).not.toHaveBeenCalled();
  });

  it('accepts a plan only once per planning cycle', () => {
    const manager = executingManager();
    const startedAt = manager.getState().executionStartedAt;
    const accepted = vi.fn();
    manager.on('plan:accepted', accepted);

    expect(() => manager.acceptPlan('clear_context_auto_accept')).toThrow('already executing');
    expect(() => manager.startExecution()).toThrow('already executing');
    expect(accepted).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({ phase: 'executing', executionStartedAt: startedAt });
  });

  it('does not complete a plan that was never accepted', () => {
    const manager = new PlanModeManager();
    manager.enable();
    manager.setPlan(plan());
    const completed = vi.fn();
    manager.on('execution:completed', completed);

    manager.completeExecution();

    expect(manager.isEnabled()).toBe(true);
    expect(manager.getPhase()).toBe('planning');
    expect(completed).not.toHaveBeenCalled();
  });

  it('completes and leaves plan mode after an accepted plan runs', () => {
    const manager = executingManager();
    const completed = vi.fn();
    manager.on('execution:completed', completed);

    manager.completeExecution();
    manager.completeExecution();

    expect(manager.isEnabled()).toBe(false);
    expect(manager.getPhase()).toBe('completed');
    expect(manager.getPlan()?.id).toBe('plan-1');
    expect(completed).toHaveBeenCalledOnce();
  });

  it('starts a new planning cycle without the plan that was already accepted', () => {
    const manager = executingManager();
    manager.completeExecution();

    manager.enable();

    expect(manager.getPhase()).toBe('planning');
    expect(manager.getPlan()).toBeNull();
    expect(() => manager.acceptPlan('auto_accept')).toThrow('No plan to accept');
  });

  it('drops the accepted plan when plan mode is turned off and on during execution', () => {
    const manager = executingManager();

    manager.disable();
    manager.enable();
    manager.completeExecution();

    expect(manager.isEnabled()).toBe(true);
    expect(manager.getPhase()).toBe('planning');
    expect(manager.getPlan()).toBeNull();
  });

  it('keeps a draft plan across plan mode toggles while still planning', () => {
    const manager = new PlanModeManager();
    manager.enable();
    manager.setPlan(plan('draft'));

    manager.disable();
    manager.enable();

    expect(manager.getPlan()?.id).toBe('draft');
    expect(manager.acceptPlan('manual_approve').option).toBe('manual_approve');
  });

  it.each([
    [{ enabled: true, phase: 'completed' as const, plan: plan() }],
    [{ enabled: true, phase: 'executing' as const, plan: null }],
  ])('restores contradictory state %o as planning so tools stay read-only', (saved) => {
    const manager = new PlanModeManager();

    manager.restore(saved);

    expect(manager.isEnabled()).toBe(true);
    expect(manager.getPhase()).toBe('planning');
    expect(manager.getPromptIndicator()).toBe('[PLAN]');
  });
});
