/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const INTERACTION_MODE_SEQUENCE = [
  'default',
  'plan',
  'yolo',
  'automode',
] as const;

export type InteractionMode = typeof INTERACTION_MODE_SEQUENCE[number];
export type InteractionModePermissionProfile = 'baseline' | 'unrestricted';

export interface InteractionModeAdapter {
  isPlanEnabled(): boolean;
  isYoloEnabled(): boolean;
  isAutomodeEnabled(): boolean;
  setPlanEnabled(enabled: boolean): void;
  setYoloEnabled(enabled: boolean): void;
  setAutomodeEnabled(enabled: boolean): void;
  setPermissionProfile(profile: InteractionModePermissionProfile): void;
}

/**
 * Owns the mutually-exclusive session interaction modes selected by Shift+Tab.
 */
export class InteractionModeController {
  constructor(private readonly adapter: InteractionModeAdapter) {}

  getMode(): InteractionMode {
    if (this.adapter.isAutomodeEnabled()) {
      return 'automode';
    }
    if (this.adapter.isYoloEnabled()) {
      return 'yolo';
    }
    if (this.adapter.isPlanEnabled()) {
      return 'plan';
    }
    return 'default';
  }

  normalizeCurrentMode(): InteractionMode {
    const mode = this.getMode();
    if (mode !== 'plan') {
      this.adapter.setPlanEnabled(false);
    }
    if (mode !== 'yolo') {
      this.adapter.setYoloEnabled(false);
    }
    if (mode !== 'automode') {
      this.adapter.setAutomodeEnabled(false);
    }
    return mode;
  }

  setMode(mode: InteractionMode): InteractionMode {
    if (mode !== 'plan') {
      this.adapter.setPlanEnabled(false);
    }
    if (mode !== 'yolo') {
      this.adapter.setYoloEnabled(false);
    }
    if (mode !== 'automode') {
      this.adapter.setAutomodeEnabled(false);
    }

    if (mode === 'plan') {
      this.adapter.setPlanEnabled(true);
    } else if (mode === 'yolo') {
      this.adapter.setYoloEnabled(true);
    } else if (mode === 'automode') {
      this.adapter.setAutomodeEnabled(true);
    }

    this.adapter.setPermissionProfile(
      mode === 'yolo' || mode === 'automode' ? 'unrestricted' : 'baseline'
    );
    return mode;
  }

  cycle(): InteractionMode {
    const currentIndex = INTERACTION_MODE_SEQUENCE.indexOf(this.getMode());
    const nextIndex = (currentIndex + 1) % INTERACTION_MODE_SEQUENCE.length;
    return this.setMode(INTERACTION_MODE_SEQUENCE[nextIndex]);
  }
}

export function getInteractionModeIndicator(mode: InteractionMode): string {
  switch (mode) {
    case 'plan':
      return '[PLAN]';
    case 'yolo':
      return '[YOLO]';
    case 'automode':
      return '[AUTO]';
    case 'default':
      return '';
  }
}

export function getInteractionModeDescription(mode: InteractionMode): string {
  switch (mode) {
    case 'plan':
      return 'Plan mode active - tools are read-only';
    case 'yolo':
      return 'YOLO mode active - actions are auto-approved';
    case 'automode':
      return 'Interactive auto mode active';
    case 'default':
      return 'Default edit mode active';
  }
}
