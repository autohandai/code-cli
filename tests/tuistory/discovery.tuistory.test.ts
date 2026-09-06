import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchTerminal, type Session } from 'tuistory';
import { createTempAutohandHome, launchBuiltAutohand, repoRoot, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

const states: TuistoryTempState[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

describe('built discovery terminal command', () => {
  it('dispatches through the installed autohand executable symlink', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    const executable = path.join(state.workspaceRoot, 'autohand');
    await symlink(path.join(repoRoot(), 'dist/index.js'), executable);
    const session = await launchTerminal({ command: executable, args: ['discovery', '--help'], cwd: state.workspaceRoot,
      env: { ...process.env, AUTOHAND_HOME: state.autohandHome, AUTOHAND_CONFIG: '', AUTOHAND_API_KEY: '', AUTOHAND_DISCOVERY_CHILD: '' },
      cols: 120, rows: 36, waitForDataTimeout: 10_000 });
    sessions.push(session);
    await waitForExit(session, 15_000);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.readAll()).toContain('Discover repository workflows');
  });
  it('shows help, scans, lists and previews uploads without launching an agent or requiring sign-in', async () => {
    const state = await createTempAutohandHome({ config: { auth: undefined } });
    states.push(state);
    await writeFile(path.join(state.workspaceRoot, 'package.json'), JSON.stringify({ name: 'terminal-discovery', scripts: { test: 'DO_NOT_EXECUTE' } }));
    async function run(args: string[]) {
      const session = await launchBuiltAutohand(['--path', state.workspaceRoot, 'discovery', ...args], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_API_KEY: '', AUTOHAND_CONFIG: '', AUTOHAND_DISCOVERY_CHILD: '' },
        waitForDataTimeout: 15_000,
      });
      sessions.push(session);
      await waitForExit(session, 20_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
      return session.readAll();
    }
    expect(await run(['--help'])).toContain('Discover repository workflows');
    expect(await run([])).toContain('Local drafts: 2 created');
    expect(await run(['list'])).toContain('repository-onboarding');
    expect(await run(['push', '--dry-run', '--select', 'repository-onboarding'])).toContain('api/discovery/push');
  });
});
