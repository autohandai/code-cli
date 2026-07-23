/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  InteractionModeController,
  INTERACTION_MODE_SEQUENCE,
} from '../../../src/core/agent/InteractionModeController.js';

describe('InteractionModeController', () => {
  it('cycles default, plan, yolo, automode, then back to default', () => {
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

    expect(INTERACTION_MODE_SEQUENCE).toEqual(['default', 'plan', 'yolo', 'automode']);

    expect(controller.cycle()).toBe('plan');
    expect(state).toEqual({
      plan: true,
      yolo: false,
      automode: false,
      permissionProfile: 'baseline',
    });

    expect(controller.cycle()).toBe('yolo');
    expect(state).toEqual({
      plan: false,
      yolo: true,
      automode: false,
      permissionProfile: 'unrestricted',
    });

    expect(controller.cycle()).toBe('automode');
    expect(state).toEqual({
      plan: false,
      yolo: false,
      automode: true,
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
