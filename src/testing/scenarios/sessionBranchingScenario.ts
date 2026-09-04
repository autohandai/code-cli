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
): Promise<void> {
  await waitForComposer(session);
  await session.type(command);
  await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes(command),
  });
  await session.press('enter');
  await session.waitForText(expectedOutput, { timeout: 20_000 });
}

export async function runSessionBranchingScenario(session: Session): Promise<string> {
  await runSlashCommand(session, '/fork', 'Forked session');
  await runSlashCommand(session, '/clone', 'Cloned session');
  await runSlashCommand(session, '/tree', 'Session tree:');
  return session.readAll();
}
