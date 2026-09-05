/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import { openAgentRunInspector } from './agentRunInspectorScenario.js';

export async function inspectNativeTeamAndNestedRun(session: Session): Promise<{ parent: string; nested: string }> {
  await openAgentRunInspector(session);
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('native-member · running · team') && text.includes('native-nested · running') });
  await session.press('enter');
  const parent = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Task: Nested team task') && text.includes('c cancel') });
  await session.press('escape');
  await session.press('down');
  await session.press('enter');
  const nested = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('native-nested · running') && text.includes('Parent: team-task:') });
  await session.press('c');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Cancel native-nested?') });
  await session.press('y');
  await session.text({ timeout: 15_000, waitFor: (text) => text.includes('native-nested · cancelled') });
  return { parent, nested };
}

export async function inspectNativeTeamFailureAndCancel(session: Session): Promise<{ completed: string; failed: string; cancelled: string }> {
  await session.press('escape');
  await session.text({ timeout: 20_000, waitFor: (text) => text.includes('native-member · completed') && text.includes('native-member · failed') && text.includes('native-member · running') });
  await session.press('up');
  await session.press('enter');
  const completed = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('TEAM_PARENT_COMPLETED') && text.includes('108 tokens') });
  await session.press('escape');
  await session.press('down');
  await session.press('down');
  await session.press('enter');
  const failed = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('native-member · failed') && text.includes('Error:') });
  await session.press('escape');
  await session.press('down');
  await session.press('enter');
  await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Task: Cancel team task') && text.includes('c cancel') });
  await session.press('c');
  await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Cancel native-member?') });
  await session.press('y');
  const cancelled = await session.text({ timeout: 15_000, waitFor: (text) => text.includes('native-member · cancelled') });
  return { completed, failed, cancelled };
}

export async function inspectNativeTeamCommandStatus(session: Session): Promise<{ help: string; status: string }> {
  await session.press('escape');
  await session.press('escape');
  await session.type('/team help');
  await session.press('enter');
  const help = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Team Commands:') && text.includes('/agents view') });
  await session.type('/team status');
  await session.press('enter');
  const status = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Failure team task — failed') && text.includes('Cancel team task — cancelled') });
  return { help, status };
}
