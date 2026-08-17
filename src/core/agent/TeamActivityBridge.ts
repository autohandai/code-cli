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

    const allTasksComplete = snapshot.tasks.length > 0
      && snapshot.tasks.every((task) => task.status === 'completed');
    if (allTasksComplete && !completionAnnounced) {
      completionAnnounced = true;
      options.notifyUser(
        `Team "${team.name}" completed ${snapshot.tasks.length}/${snapshot.tasks.length} tasks.`,
      );
    } else if (!allTasksComplete) {
      completionAnnounced = false;
    }
  });
}
