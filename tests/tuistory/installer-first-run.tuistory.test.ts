import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Session } from 'tuistory';
import { describe, expect, it } from 'vitest';
import { launchTuistorySession } from '../../src/testing/drivers/tuistory-driver.js';
import { answerInstallerFirstRun, prepareInstallerFirstRun } from '../../src/testing/scenarios/installerFirstRunScenario.js';
import { repoRoot } from './helpers/autohandTuistory.js';

describe.skipIf(process.platform === 'win32')('installer first message in a real terminal', () => {
  it.each([true, false])('honors the first-run choice (accepted: %s)', async accepted => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-first-run-pty-'));
    let session: Session | undefined;
    try {
      const fixture = await prepareInstallerFirstRun(path.join(repoRoot(), 'install.sh'), directory);
      session = await launchTuistorySession({
        command: '/bin/sh', args: [fixture.script], cwd: directory,
        env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', AUTOHAND_CLI: undefined,
          AUTOHAND_INSTALL_FIRST_RUN: undefined, AUTOHAND_TEST_BINARY: fixture.binary,
          AUTOHAND_TEST_FIRST_RUN_LOG: fixture.log },
      });
      const output = await answerInstallerFirstRun(session, accepted);
      expect(session.exitInfo?.exitCode, output).toBe(0);
      expect(output).toContain('What can you do in this folder? Give me 3 quick ideas.');
      if (accepted) expect(await fs.readFile(fixture.log, 'utf8')).toBe('What can you do in this folder? Give me 3 quick ideas.\n');
      else await expect(fs.access(fixture.log)).rejects.toThrow();
    } finally {
      session?.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
