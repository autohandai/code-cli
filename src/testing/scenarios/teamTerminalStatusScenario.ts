/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

export async function inspectTerminalTeamOutcomes(session: Session): Promise<{ team: string; tasks: string }> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Create a security team and cancel its dependent documentation task.');
  await session.press('enter');
  await session.waitForText('TEAM_BACKGROUND_WORK_STARTED', { timeout: 60_000 });
  await session.press(['ctrl', 't']);
  const team = await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes('Team: team-e2e')
      && text.includes('[failed]') && text.includes('[cancelled]'),
  });
  await session.press(['ctrl', 't']);
  await session.type('/tasks');
  await session.press('enter');
  const tasks = await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('failed · 1') && text.includes('cancelled · 1')
      && text.includes('0/2 done'),
  });
  return { team, tasks };
}
