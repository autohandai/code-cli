/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentOutputEvent } from '../../types.js';
import type { TeamManager } from '../teams/TeamManager.js';
import type { TeamActivitySnapshot } from '../teams/types.js';
import type { InteractionMode } from './InteractionModeController.js';

export interface TeamActivityBridgeOptions {
  teamManager: Pick<TeamManager, 'subscribe'>;
  isInteractive: boolean;
  getInteractionMode(): InteractionMode;
  setInteractionMode(mode: InteractionMode): void;
  setTeamActivity(snapshot: TeamActivitySnapshot): void;
  emitOutput(event: AgentOutputEvent): void;
  notifyUser(message: string): void;
}

export function enableAutomaticCoordinationMode(
  options: Pick<
    TeamActivityBridgeOptions,
    'isInteractive' | 'getInteractionMode' | 'setInteractionMode'
  >,
): void {
  if (options.isInteractive && options.getInteractionMode() === 'default') {
    options.setInteractionMode('automode');
  }
}

export function attachTeamActivityBridge(options: TeamActivityBridgeOptions): () => void {
  let activeTeamName: string | null = null;
  let completionAnnounced = false;

  return options.teamManager.subscribe((snapshot) => {
    options.setTeamActivity(snapshot);
    const team = snapshot.team;
    if (!team) {
      activeTeamName = null;
      completionAnnounced = false;
      return;
    }

    if (activeTeamName !== team.name) {
      activeTeamName = team.name;
      completionAnnounced = false;
      enableAutomaticCoordinationMode(options);
    }

    options.emitOutput({ type: 'team_update', teamActivity: snapshot });

    const completed = snapshot.tasks.filter((task) => task.status === 'completed').length;
    const failed = snapshot.tasks.filter((task) => task.status === 'failed').length;
    const cancelled = snapshot.tasks.filter((task) => task.status === 'cancelled').length;
    const total = snapshot.tasks.length;
    const allTasksFinished = total > 0 && completed + failed + cancelled === total;
    if (allTasksFinished && !completionAnnounced) {
      completionAnnounced = true;
      const outcomes = [
        `${completed}/${total} completed`,
        ...(failed > 0 ? [`${failed} failed`] : []),
        ...(cancelled > 0 ? [`${cancelled} cancelled`] : []),
      ];
      options.notifyUser(completed === total
        ? `Team "${team.name}" completed ${total}/${total} tasks.`
        : `Team "${team.name}" finished: ${outcomes.join(', ')}.`);
    } else if (!allTasksFinished) {
      completionAnnounced = false;
    }
  });
}
