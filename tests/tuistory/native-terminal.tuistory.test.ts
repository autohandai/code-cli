/** @license Apache-2.0 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareNativeTerminalTest } from '../../src/testing/drivers/native-terminal-driver.js';
import { launchTuistorySession, waitForExit } from '../../src/testing/drivers/tuistory-driver.js';

describe.skipIf(!process.env.AUTOHAND_NATIVE_TERMINAL)('native macOS terminal compatibility', () => {
  it('retains one transcript and composer through idle and streaming window resizes', async () => {
    const test = await prepareNativeTerminalTest();
    const session = await launchTuistorySession({ command: '/usr/bin/xcodebuild', args: test.args,
      cwd: process.cwd(), cols: 180, rows: 50, waitForDataTimeout: 120_000, env: { ...process.env, CI: 'true' } });
    try {
      await waitForExit(session, 300_000);
      expect(session.exitInfo?.exitCode, session.getRawOutput().slice(-10_000)).toBe(0);
      expect(session.getRawOutput()).toContain('NATIVE_TERMINAL_IDLE_PASS');
      expect(session.getRawOutput()).toContain('NATIVE_TERMINAL_STREAMING_PASS');
      expect(existsSync(path.join(test.resultBundle, 'Info.plist'))).toBe(true);
    } finally {
      session.close();
      await writeFile(path.join(path.dirname(test.resultBundle), 'xcodebuild.log'), session.getRawOutput());
    }
  }, 360_000);
});
