/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Session } from 'tuistory';

const execFileAsync = promisify(execFile);

export async function enqueueGoalFromAnotherProcess(workspaceRoot: string, objective: string): Promise<void> {
  const moduleUrl = new URL('../../goals/GoalManager.ts', import.meta.url).href;
  await execFileAsync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '--eval',
    `import { GoalManager } from ${JSON.stringify(moduleUrl)};
     const result = await new GoalManager(process.argv[1]).enqueueGoal({ objective: process.argv[2], source: 'cli' });
     if (!result.ok) throw new Error(result.message);`,
    workspaceRoot, objective,
  ], { timeout: 15_000 });
}

export async function openLiveGoalPanel(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.press(['ctrl', 'g']);
  await session.waitForText('Goals ·', { timeout: 5000 });
}

export async function expectGoalPanelRefresh(session: Session, text: string): Promise<void> {
  await session.waitForText(text, { timeout: 5000 });
}
