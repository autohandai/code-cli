/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import type { GoalSessionSnapshot } from '../../goals/types.js';

export function createLongGoalsSnapshot(): GoalSessionSnapshot {
  const transcript = '\nFULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER '.repeat(100);
  return {
    version: 2,
    goal: {
      goalId: 'goal-active',
      objective: `Repair failing goal tests${transcript}`,
      status: 'paused',
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    queue: [{
      queueId: 'queue-next',
      objective: `Review the terminal layout${transcript}`,
      source: 'command',
      createdAt: 2,
    }],
    peers: [{
      sessionId: 'other-session',
      objective: `Ship the documentation${transcript}`,
      status: 'active',
      ownerAlive: false,
    }],
    completed: [],
    updatedAt: 2,
    sessionAttachment: 'attached',
  };
}

export async function openGoalsPanel(session: Session, command = '/goals'): Promise<void> {
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('❯') });
  await session.type(command);
  if (command === '/goals') {
    await session.waitForText('Open the live goals queue', { timeout: 5_000 });
  }
  await session.press('enter');
  await session.waitForText('Goals ·', { timeout: 5_000 });
}

export async function editSecondGoalSummary(session: Session): Promise<void> {
  await session.press('down');
  await session.press('down');
  await session.press('up');
  await session.press('down');
  await session.waitForText('› 2. Review the terminal layout');
  await session.press('enter');
  await session.waitForText('FULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER');
  await session.type(' after review');
  await session.press('enter');
}
