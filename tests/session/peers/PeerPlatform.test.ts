import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'ah-platform-probe-')); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('real Node and compiled Bun IPC compatibility', () => {
  it.each(['node', 'compiled-bun'] as const)('authenticates and persists a boundary-size message under %s', async runtime => {
    const workspace = path.join(directory, runtime, 'workspace');
    await mkdir(workspace, { recursive: true });
    const output = path.join(directory, runtime === 'node' ? 'probe.mjs' : process.platform === 'win32' ? 'probe.exe' : 'probe');
    const entry = path.resolve('src/testing/scenarios/peerPlatformProbe.ts');
    const args = runtime === 'node' ? ['build', entry, '--target=node', '--outfile', output] : ['build', entry, '--compile', '--outfile', output];
    execFileSync('bun', args, { cwd: process.cwd(), timeout: 60_000, stdio: 'pipe' });
    const home = path.join(directory, runtime, 'home');
    const result = execFileSync(runtime === 'node' ? process.execPath : output, runtime === 'node' ? [output, home, workspace] : [home, workspace], { encoding: 'utf8', timeout: 20_000 });
    const probe = JSON.parse(result.trim());
    expect(probe).toMatchObject({ bytes: 8_000, count: 1, contentMatches: true, receipt: 'accepted', consumed: 'consumed', security: { currentUserOnly: true, authentication: 'mutual-ed25519' } });
    if (process.platform === 'win32') {
      expect(probe.endpoint).toMatch(/^\\\\\.\\pipe\\/);
      expect(probe.security.evidence).toBe('windows-acl');
    } else {
      expect(probe.endpoint).not.toMatch(/^https?:|^tcp:/);
      expect(probe.security.evidence).toBe('posix-owner-mode');
    }
  }, 90_000);
});
