import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { launchTuistorySession } from '../../src/testing/drivers/tuistory-driver.js';
import { prepareZitPackageInstallScenario } from '../../src/testing/scenarios/zitPackageInstallScenario.js';
import { createTempAutohandHome, exitInteractive, repoRoot, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

describe.skipIf(!['darwin', 'linux'].includes(process.platform))('packaged Zit startup Tuistory', () => {
  it.each(['npm', 'bun'] as const)('starts --zit after an untrusted %s package install and exits through Ctrl+C', async (manager) => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false }, agent: { autoMemory: false } } });
    states.push(state);
    await writeFile(path.join(state.workspaceRoot, 'README.md'), '# Zit startup fixture\n');
    execFileSync('git', ['add', '.'], { cwd: state.workspaceRoot });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initialize fixture'], { cwd: state.workspaceRoot });
    const scenarioRoot = path.join(state.autohandHome, 'package-scenario');
    await mkdir(scenarioRoot);
    const installed = await prepareZitPackageInstallScenario(repoRoot(), scenarioRoot, manager);
    const binary = path.join(installed.packageRoot, 'vendor', 'zit', `${process.platform}-${process.arch}`, 'zit');
    const manifest = JSON.parse(await readFile(path.join(path.dirname(binary), 'manifest.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe('0.1.2');
    const args = [installed.entryPath, '--zit', '--path', state.workspaceRoot, '--config', state.configPath, '--yes'];
    const env = {
      ...process.env, CI: 'false', NO_COLOR: '1', AUTOHAND_NO_BANNER: '1',
      AUTOHAND_HOME: state.autohandHome, AUTOHAND_SKIP_UPDATE_CHECK: '1', AUTOHAND_SKIP_PING: '1',
      AUTOHAND_OFFLINE: '1', AUTOHAND_DISABLE_AUTO_REPORT: '1', AUTOHAND_DISABLE_COMPUTER_USE: '1',
      ZIT_HOME: path.join(state.autohandHome, 'zit-home'), ZIT_BIN: undefined, ZIT_WORKSPACE: undefined,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    };

    const hidden = `${binary}.hidden`;
    await rename(binary, hidden);
    const missing = await launchTuistorySession({ command: process.execPath, args, env, cwd: state.workspaceRoot, cols: 120, rows: 36 });
    sessions.push(missing);
    await waitForExit(missing, 20_000);
    expect(missing.readAll()).toContain('--zit requires the zit CLI');
    expect(missing.exitInfo?.exitCode).toBe(1);
    await rename(hidden, binary);

    const session = await launchTuistorySession({ command: process.execPath, args, env, cwd: state.workspaceRoot, cols: 120, rows: 36, waitForDataTimeout: 20_000 });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 25_000 });
    expect(execFileSync('git', ['rev-parse', '--verify', 'refs/zit/current'], { cwd: state.workspaceRoot, encoding: 'utf8' }).trim()).not.toBe('');
    expect(session.readAll()).not.toContain('--zit requires the zit CLI');
    await exitInteractive(session);
    expect(session.readAll()).toContain('zit:');
  }, 120_000);
});
