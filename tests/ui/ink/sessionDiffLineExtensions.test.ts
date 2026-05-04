/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createSessionDiffLineExtensions,
  startSessionDiffLineExtension,
} from '../../../src/ui/ink/sessionDiffLineExtensions.js';
import type { SessionDiffStatsTracker } from '../../../src/core/SessionDiffStatsTracker.js';

describe('session diff line extensions', () => {
  it('creates status and help segments from computed session diff stats', () => {
    expect(createSessionDiffLineExtensions({ added: 18, removed: 4 })).toEqual({
      status: {
        segments: [
          { id: 'session-lines-added', text: '+18 lines', color: 'success' },
          { id: 'session-lines-removed', text: '-4 lines', color: 'error' },
        ],
      },
      help: {
        segments: [
          {
            id: 'session-diff-summary',
            text: 'session diff: +18 / -4',
            color: 'muted',
          },
        ],
      },
    });
  });

  it('refreshes the renderer from a tracker without callers tracking counts themselves', () => {
    const renderer = { setLineExtensions: vi.fn() };
    const tracker = {
      getStats: vi.fn(() => ({ added: 3, removed: 1 })),
    } as unknown as SessionDiffStatsTracker;

    const controller = startSessionDiffLineExtension({ renderer, tracker, intervalMs: 0 });
    const stats = controller.refresh();

    expect(stats).toEqual({ added: 3, removed: 1 });
    expect(renderer.setLineExtensions).toHaveBeenLastCalledWith(
      createSessionDiffLineExtensions({ added: 3, removed: 1 })
    );

    controller.stop();
  });
});
