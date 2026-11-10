import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { TmuxTestServer } from '../../src/testing/drivers/tmux-driver.js';
import { resolveZitBin } from '../../src/utils/sessionZit.js';
import { launchTuistorySession, exitInteractive } from '../../src/testing/drivers/tuistory-driver.js';
import { outputViewport } from '../../src/testing/scenarios/compactOutputScenario.js';
import { createTempAutohandHome, type TuistoryTempState } from './helpers/autohandTuistory.js';

let compiledDirectory: string | undefined;
let executable: string;
let session: Session | undefined;
let state: TuistoryTempState | undefined;
let server: TmuxTestServer | undefined;

describe.skipIf(process.platform === 'win32')('standalone tmux startup', () => {
  beforeAll(async () => {
    if (process.env.AUTOHAND_TUISTORY_EXECUTABLE) {
      executable = path.resolve(process.env.AUTOHAND_TUISTORY_EXECUTABLE);
      return;
    }
    compiledDirectory = await mkdtemp(path.join(os.tmpdir(), 'autohand-tmux-compiled-'));
    executable = path.join(compiledDirectory, 'autohand');
    execFileSync('bun', ['build', path.resolve('src/index.ts'), '--compile', '--external', 'node-llama-cpp', '--outfile', executable],
      { cwd: process.cwd(), timeout: 60_000, stdio: 'pipe' });
  });
  afterAll(async () => { if (compiledDirectory) await rm(compiledDirectory, { recursive: true, force: true }); });
  afterEach(async () => { session?.close(); server?.stop(); await state?.cleanup(); session = undefined; state = undefined; server = undefined; });

  it.each(['current-directory', 'worktree', 'zit'])('starts %s isolation, preserves resize input, and exits cleanly', async isolation => {
    state = await createTempAutohandHome({ initializeGit: isolation !== 'current-directory', config: {
      features: { fullScreenMode: true }, agent: { autoMemory: false }, ui: { promptSuggestions: false },
    } });
    if (isolation !== 'current-directory') {
      await writeFile(path.join(state.workspaceRoot, 'README.md'), '# Terminal fixture\n');
      execFileSync('git', ['add', '.'], { cwd: state.workspaceRoot });
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initialize terminal fixture'], { cwd: state.workspaceRoot });
    }
    server = new TmuxTestServer();
    const searchPath = await server.prepare(path.join(state.autohandHome, 'bin'));
    const flags = isolation === 'worktree' ? ['--worktree', 'tmux-fixture'] : isolation === 'zit' ? ['--zit'] : [];
    session = await launchTuistorySession({ command: '/usr/bin/env',
      args: ['TERM=xterm-256color', executable, '--tmux', ...flags, '--config', state.configPath, '--offline', '--yes'],
      cwd: state.workspaceRoot, cols: 120, rows: 36, waitForDataTimeout: 20_000,
      env: { ...process.env, PATH: searchPath, TMUX: undefined, TMUX_PANE: undefined,
        CI: 'false', TERM: 'xterm-256color', AUTOHAND_HOME: state.autohandHome,
        AUTOHAND_OFFLINE: '1', AUTOHAND_DISABLE_COMPUTER_USE: '1', AUTOHAND_SKIP_UPDATE_CHECK: '1',
        AUTOHAND_NO_BROWSER: '1', AUTOHAND_SKIP_PING: '1', AUTOHAND_DISABLE_AUTO_REPORT: '1',
        ZIT_HOME: path.join(state.autohandHome, 'zit-home'),
        ZIT_BIN: process.env.AUTOHAND_TUISTORY_ZIT_BIN ?? resolveZitBin(),
        AUTOHAND_TMUX_LAUNCHED: undefined },
    });
    await session.waitForText('Plan, search, build anything', { timeout: 20_000 });
    await session.type('preserved tmux draft');
    const historySize = server.snapshot().historySize;
    for (const [cols, rows] of [[100, 30], [70, 24], [120, 36]]) {
      session.resize({ cols, rows });
      await session.waitForText('preserved tmux draft');
      await vi.waitFor(() => {
        const pane = server!.snapshot();
        expect(pane.historySize).toBe(historySize);
        expect(pane.text.match(/^>_ Autohand Code/gm), pane.text).toHaveLength(1);
        expect(pane.text.match(/❯ preserved tmux draft/g), pane.text).toHaveLength(1);
        const screen = outputViewport(session!);
        expect(screen.match(/^>_ Autohand Code/gm), screen).toHaveLength(1);
        expect(screen.match(/❯ preserved tmux draft/g), screen).toHaveLength(1);
      }, { timeout: 5_000, interval: 50 });
    }
    await exitInteractive(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.readAll()).not.toContain('Module not found');
    expect(session.readAll()).not.toContain('--zit cannot be used with --tmux');
  });
});
