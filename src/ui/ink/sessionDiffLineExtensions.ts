/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentUILineExtensions } from './AgentUI.js';
import type { SessionDiffStats, SessionDiffStatsTracker } from '../../core/SessionDiffStatsTracker.js';

export interface SessionDiffLineExtensionRenderer {
  setLineExtensions(lineExtensions: AgentUILineExtensions | undefined): void;
}

export interface SessionDiffLineExtensionOptions {
  renderer: SessionDiffLineExtensionRenderer;
  tracker: Pick<SessionDiffStatsTracker, 'getStats'>;
  intervalMs?: number;
}

export interface SessionDiffLineExtensionController {
  refresh(): SessionDiffStats;
  stop(): void;
}

export function createSessionDiffLineExtensions(stats: SessionDiffStats): AgentUILineExtensions {
  const hasChanges = stats.added > 0 || stats.removed > 0;

  return {
    status: {
      segments: [
        {
          id: 'session-lines-added',
          text: stats.added > 0 ? `+${stats.added} lines` : '',
          color: 'success',
        },
        {
          id: 'session-lines-removed',
          text: stats.removed > 0 ? `-${stats.removed} lines` : '',
          color: 'error',
        },
      ],
    },
    help: {
      segments: [
        {
          id: 'session-diff-summary',
          text: hasChanges ? `session diff: +${stats.added} / -${stats.removed}` : '',
          color: 'muted',
        },
      ],
    },
  };
}

export function startSessionDiffLineExtension(
  options: SessionDiffLineExtensionOptions
): SessionDiffLineExtensionController {
  const refresh = (): SessionDiffStats => {
    const stats = options.tracker.getStats();
    options.renderer.setLineExtensions(createSessionDiffLineExtensions(stats));
    return stats;
  };

  refresh();

  const interval = options.intervalMs && options.intervalMs > 0
    ? setInterval(refresh, options.intervalMs)
    : null;

  return {
    refresh,
    stop: () => {
      if (interval) {
        clearInterval(interval);
      }
    },
  };
}
