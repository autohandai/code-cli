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

export async function recoverFailedTeam(session: Session) {
  await session.press(['ctrl', 't']);
  await session.waitForText('Enter inspect');
  await session.press('enter');
  const failure = await session.text({ timeout: 10_000, waitFor: text => text.includes('SECURITY_TASK_FAILED') });
  await session.press('escape');
  await session.waitForText('Enter inspect');
  await session.press('r');
  await session.waitForText('Retry Review authentication?');
  await session.press('y');
  await session.waitForText('Retrying 1 failed task');
  await session.press(['ctrl', 't']);
  const retried = await session.text({ timeout: 30_000, waitFor: text => text.includes('1 succeeded') && text.includes('1 cancelled') });
  await session.press('s');
  await session.waitForText('Shut down this team');
  await session.press('n');
  await session.waitForText('Enter inspect');
  await session.press('s');
  await session.waitForText('Shut down this team');
  await session.press('y');
  const closed = await session.text({ timeout: 15_000, waitFor: text => text.includes('has been shut down') && text.includes('❯') });
  await session.type('/team create replacement');
  await session.press('enter');
  const replacement = await session.text({ timeout: 10_000, waitFor: text => text.includes('Team "replacement" created') });
  await session.type('/team shutdown');
  await session.press('enter');
  await session.waitForText('Team "replacement" has been shut down');
  return { failure, retried, closed, replacement };
}
