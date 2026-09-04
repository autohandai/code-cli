/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';

async function waitForComposer(session: Session): Promise<void> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
}

async function runSlashCommand(
  session: Session,
  command: string,
  expectedOutput: string,
): Promise<string> {
  await waitForComposer(session);
  await session.type(command);
  await session.press('enter');
  return session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes(expectedOutput),
  });
}

export async function runCollaborationCommandsScenario(session: Session): Promise<string> {
  const evidence: string[] = [];
  evidence.push(await runSlashCommand(session, '/team create docs-demo', 'Team "docs-demo" created.'));
  evidence.push(await runSlashCommand(session, '/team status', 'Team: docs-demo'));
  evidence.push(await runSlashCommand(session, '/tasks', 'No tasks'));
  evidence.push(await runSlashCommand(session, '/message docs-reviewer', 'Usage:'));

  evidence.push(await runSlashCommand(session, '/team view', 'Team: docs-demo'));
  await session.press(['ctrl', 't']);
  await waitForComposer(session);

  evidence.push(await runSlashCommand(session, '/team shutdown', 'Team "docs-demo" has been shut down.'));
  evidence.push(await runSlashCommand(session, '/agents definitions', 'Sub-Agent Definitions'));

  await waitForComposer(session);
  await session.type('/agents');
  await session.press('enter');
  evidence.push(await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('Active Autohand Agents'),
  }));
  await session.press('escape');
  await waitForComposer(session);

  await session.type('/peers');
  await session.press('enter');
  evidence.push(await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('No active peers'),
  }));
  await session.type('q');
  await waitForComposer(session);

  return evidence.join('\n');
}
