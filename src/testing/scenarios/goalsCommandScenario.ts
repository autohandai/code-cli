/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fse from 'fs-extra';
import type { Session } from 'tuistory';
import type { GoalSessionSnapshot } from '../../goals/types.js';
import { PROJECT_DIR_NAME } from '../../constants.js';

/**
 * Startup reads the workspace goal state between mounting Ink and marking the
 * composer idle. Stalling that read keeps the window open long enough for a
 * Tuistory session to type into it deterministically.
 */
export async function createStalledGoalStatePreload(
  workspaceRoot: string,
  preloadDirectory: string,
  stallMs = 1_500,
): Promise<string> {
  const goalStatePath = path.join(workspaceRoot, PROJECT_DIR_NAME, 'goals.local.json');
  await fse.ensureDir(path.dirname(goalStatePath));
  await fse.writeJson(goalStatePath, { version: 2, goals: {}, queue: [], completed: [], updatedAt: Date.now() });

  const preload = path.join(preloadDirectory, 'stalled-goal-state.mjs');
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const readFile = fs.readFile;
fs.readFile = function(file, ...rest) {
  if (String(file) === ${JSON.stringify(goalStatePath)}) {
    setTimeout(() => readFile.call(fs, file, ...rest), ${stallMs});
    return;
  }
  return readFile.call(fs, file, ...rest);
};
syncBuiltinESMExports();
`);
  return `--import=${pathToFileURL(preload).href}`;
}

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
