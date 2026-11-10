/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  InteractionModeController,
  INTERACTION_MODE_SEQUENCE,
  type InteractionMode,
} from '../../../src/core/agent/InteractionModeController.js';

describe('InteractionModeController', () => {
  function createController(initial: InteractionMode) {
    const state = { plan: false, yolo: false, automode: false, profile: 'baseline' };
    const controller = new InteractionModeController({
      isPlanEnabled: () => state.plan,
      isYoloEnabled: () => state.yolo,
      isAutomodeEnabled: () => state.automode,
      setPlanEnabled: enabled => { state.plan = enabled; },
      setYoloEnabled: enabled => { state.yolo = enabled; },
      setAutomodeEnabled: enabled => { state.automode = enabled; },
      setPermissionProfile: profile => { state.profile = profile; },
    });
    controller.setMode(initial);
    return { controller, state };
  }

  it.each(INTERACTION_MODE_SEQUENCE)('restores %s after temporary computer auto mode', previous => {
    const { controller, state } = createController(previous);
    const restore = controller.enterTemporaryMode('automode');
    expect(controller.getMode()).toBe('automode');
    expect(state.profile).toBe('unrestricted');
    restore();
    restore();
    expect(controller.getMode()).toBe(previous);
    expect(state.profile).toBe(previous === 'automode' || previous === 'yolo' ? 'unrestricted' : 'baseline');
  });

  it.each(INTERACTION_MODE_SEQUENCE)('preserves an explicit %s selection during computer auto mode', selected => {
    const { controller } = createController('default');
    const restore = controller.enterTemporaryMode('automode');
    controller.setMode(selected);
    restore();
    expect(controller.getMode()).toBe(selected);
  });

  it('keeps an outer temporary mode active through a nested turn', () => {
    const { controller } = createController('plan');
    const restoreOuter = controller.enterTemporaryMode('automode');
    const restoreInner = controller.enterTemporaryMode('automode');
    restoreInner();
    expect(controller.getMode()).toBe('automode');
    restoreOuter();
    expect(controller.getMode()).toBe('plan');
  });

  it('cycles default, plan, automode, yolo, then back to default', () => {
    const state = {
      plan: false,
      yolo: false,
      automode: false,
      permissionProfile: 'baseline' as 'baseline' | 'unrestricted',
    };
    const controller = new InteractionModeController({
      isPlanEnabled: () => state.plan,
      isYoloEnabled: () => state.yolo,
      isAutomodeEnabled: () => state.automode,
      setPlanEnabled: (enabled) => { state.plan = enabled; },
      setYoloEnabled: (enabled) => { state.yolo = enabled; },
      setAutomodeEnabled: (enabled) => { state.automode = enabled; },
      setPermissionProfile: (profile) => { state.permissionProfile = profile; },
    });

    expect(INTERACTION_MODE_SEQUENCE).toEqual(['default', 'plan', 'automode', 'yolo']);

    expect(controller.cycle()).toBe('plan');
    expect(state).toEqual({
      plan: true,
      yolo: false,
      automode: false,
      permissionProfile: 'baseline',
    });

    expect(controller.cycle()).toBe('automode');
    expect(state).toEqual({
      plan: false,
      yolo: false,
      automode: true,
      permissionProfile: 'unrestricted',
    });

    expect(controller.cycle()).toBe('yolo');
    expect(state).toEqual({
      plan: false,
      yolo: true,
      automode: false,
      permissionProfile: 'unrestricted',
    });

    expect(controller.cycle()).toBe('default');
    expect(state).toEqual({
      plan: false,
      yolo: false,
      automode: false,
      permissionProfile: 'baseline',
    });
  });

  it('clears every competing mode before applying the selected mode', () => {
    const setPlanEnabled = vi.fn();
    const setYoloEnabled = vi.fn();
    const setAutomodeEnabled = vi.fn();
    const setPermissionProfile = vi.fn();
    const controller = new InteractionModeController({
      isPlanEnabled: () => true,
      isYoloEnabled: () => true,
      isAutomodeEnabled: () => true,
      setPlanEnabled,
      setYoloEnabled,
      setAutomodeEnabled,
      setPermissionProfile,
    });

    controller.setMode('plan');

    expect(setPlanEnabled).toHaveBeenCalledWith(true);
    expect(setYoloEnabled).toHaveBeenCalledWith(false);
    expect(setAutomodeEnabled).toHaveBeenCalledWith(false);
    expect(setPermissionProfile).toHaveBeenCalledWith('baseline');
  });

  it('normalizes conflicting startup modes without rewriting the selected mode', () => {
    const state = {
      plan: true,
      yolo: true,
      automode: true,
      permissionProfile: 'unrestricted' as 'baseline' | 'unrestricted',
    };
    const setPermissionProfile = vi.fn((profile: 'baseline' | 'unrestricted') => {
      state.permissionProfile = profile;
    });
    const controller = new InteractionModeController({
      isPlanEnabled: () => state.plan,
      isYoloEnabled: () => state.yolo,
      isAutomodeEnabled: () => state.automode,
      setPlanEnabled: (enabled) => { state.plan = enabled; },
      setYoloEnabled: (enabled) => { state.yolo = enabled; },
      setAutomodeEnabled: (enabled) => { state.automode = enabled; },
      setPermissionProfile,
    });

    expect(controller.normalizeCurrentMode()).toBe('automode');
    expect(state).toEqual({
      plan: false,
      yolo: false,
      automode: true,
      permissionProfile: 'unrestricted',
    });
    expect(setPermissionProfile).not.toHaveBeenCalled();
  });
});
