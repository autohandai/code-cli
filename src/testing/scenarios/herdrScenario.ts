/** @license Apache-2.0 */
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';

export async function createHerdrFixture(directory: string): Promise<{ binPath: string; logPath: string }> {
  const binPath = path.join(directory, 'herdr-fixture');
  const logPath = path.join(directory, 'herdr-reports.log');
  const quotedLogPath = `'${logPath.replaceAll("'", "'\\''")}'`;
  await writeFile(binPath, `#!/bin/sh
printf '%s\\037' "$@" >> ${quotedLogPath}
printf '\\n' >> ${quotedLogPath}
`, { mode: 0o755 });
  await chmod(binPath, 0o755);
  return { binPath, logPath };
}

export async function submitHerdrTurn(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('Complete a short response for the pane test');
  await session.press('enter');
  await session.waitForText('HERDR_TURN_DONE', { timeout: 20_000 });
}
