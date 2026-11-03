import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { waitForExit } from '../drivers/tuistory-driver.js';

export async function prepareInstallerFirstRun(installer: string, directory: string): Promise<{
  script: string;
  binary: string;
  log: string;
}> {
  const source = await fs.readFile(installer, 'utf8');
  const footer = 'main "$@" || exit 1\n';
  if (!source.endsWith(footer)) throw new Error('Installer entry point changed; refusing to execute it in the prompt fixture.');
  const script = path.join(directory, 'first-run.sh');
  const binary = path.join(directory, 'autohand-fixture');
  const log = path.join(directory, 'first-run.log');
  await fs.writeFile(script, source.slice(0, -footer.length) + '\noffer_first_run "$AUTOHAND_TEST_BINARY"\n');
  await fs.writeFile(binary, '#!/bin/sh\ncat > "$AUTOHAND_TEST_FIRST_RUN_LOG"\n', { mode: 0o755 });
  return { script, binary, log };
}

export async function answerInstallerFirstRun(session: Session, accepted: boolean): Promise<string> {
  await session.waitForText('[Y/n]', { timeout: 5_000 });
  if (!accepted) await session.type('n');
  await session.press('enter');
  await waitForExit(session, 5_000);
  return session.readAll();
}
