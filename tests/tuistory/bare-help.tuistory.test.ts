import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchTuistorySession, waitForExit, expectCleanExit } from '../../src/testing/drivers/tuistory-driver.js';

describe('bare-mode CLI help', () => {
  it('describes real skipped startup work without promising LSP', async () => {
    const session = await launchTuistorySession({ command: process.execPath,
      args: [path.resolve('dist/index.js'), '--help'], cols: 180, rows: 100,
      env: { ...process.env, FORCE_COLOR: '0' }, waitForData: false });
    try {
      await waitForExit(session, 20_000);
      expectCleanExit(session);
      const output = session.getRawOutput().replace(/\s+/g, ' ');
      expect(output).toContain('Minimal mode: skip hooks, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and AGENTS.md auto-discovery');
      const bareDescription = output.match(/--bare (.*?)(?= --[a-z])/u)?.[1];
      expect(bareDescription).toBeDefined();
      expect(bareDescription).not.toContain('LSP');
    } finally { session.close(); }
  });
});
