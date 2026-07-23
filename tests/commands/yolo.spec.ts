/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { toggleYolo } from '../../src/commands/yolo.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { InteractionMode } from '../../src/core/agent/InteractionModeController.js';

describe('/yolo command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('distinguishes automode from yolo even though both use unrestricted permissions', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let interactionMode: InteractionMode = 'automode';
    const setInteractionMode = vi.fn((mode: InteractionMode) => {
      interactionMode = mode;
      return mode;
    });
    const ctx = {
      permissionManager: { getMode: () => 'unrestricted' },
      getInteractionMode: () => interactionMode,
      setInteractionMode,
    } as unknown as SlashCommandContext;

    await toggleYolo(ctx);

    expect(setInteractionMode).toHaveBeenCalledWith('yolo');
    expect(interactionMode).toBe('yolo');
  });

  it('returns from yolo to the default interaction mode', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let interactionMode: InteractionMode = 'yolo';
    const setInteractionMode = vi.fn((mode: InteractionMode) => {
      interactionMode = mode;
      return mode;
    });
    const ctx = {
      permissionManager: { getMode: () => 'unrestricted' },
      getInteractionMode: () => interactionMode,
      setInteractionMode,
    } as unknown as SlashCommandContext;

    await toggleYolo(ctx);

    expect(setInteractionMode).toHaveBeenCalledWith('default');
    expect(interactionMode).toBe('default');
  });
});
