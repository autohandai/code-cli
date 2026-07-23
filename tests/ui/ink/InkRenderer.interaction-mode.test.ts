/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
import type { InteractionMode } from '../../../src/core/agent/InteractionModeController.js';

describe('InkRenderer interaction mode state', () => {
  it('preserves the agent-owned mode when resetting conversation state', () => {
    let interactionMode: InteractionMode = 'yolo';
    const renderer = new InkRenderer({
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
      getInteractionMode: () => interactionMode,
    });

    expect(renderer.getState().interactionMode).toBe('yolo');

    interactionMode = 'automode';
    renderer.reset();

    expect(renderer.getState().interactionMode).toBe('automode');
  });
});
