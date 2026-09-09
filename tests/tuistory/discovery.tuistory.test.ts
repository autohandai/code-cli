import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchTerminal, type Session } from 'tuistory';
import {
  createTempAutohandHome,
  launchBuiltAutohand,
  repoRoot,
  waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';
import { cancelDiscoveryUpload } from '../../src/testing/scenarios/discoveryScenario.js';

const states: TuistoryTempState[] = [];
const sessions: Session[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const state of states.splice(0)) await state.cleanup();
});

describe('built discovery terminal command', () => {
  it('dispatches through the installed autohand executable symlink', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    const executable = path.join(state.workspaceRoot, 'autohand');
    await symlink(path.join(repoRoot(), 'dist/index.js'), executable);
    const session = await launchTerminal({
      command: executable,
      args: ['discovery', '--help'],
      cwd: state.workspaceRoot,
      env: {
        ...process.env,
        AUTOHAND_HOME: state.autohandHome,
        AUTOHAND_CONFIG: '',
        AUTOHAND_API_KEY: '',
        AUTOHAND_DISCOVERY_CHILD: '',
      },
      cols: 120,
      rows: 36,
      waitForDataTimeout: 10_000,
    });
    sessions.push(session);
    await waitForExit(session, 15_000);
    expect(session.exitInfo?.exitCode).toBe(0);
    expect(session.readAll()).toContain('Discover repository workflows');
  });
  it('shows help, scans, lists and previews uploads without launching an agent or requiring sign-in', async () => {
    const state = await createTempAutohandHome({ config: { auth: undefined } });
    states.push(state);
    await writeFile(
      path.join(state.workspaceRoot, 'package.json'),
      JSON.stringify({
        name: 'terminal-discovery',
        scripts: { test: 'DO_NOT_EXECUTE' },
      })
    );
    async function run(args: string[]) {
      const session = await launchBuiltAutohand(
        ['--path', state.workspaceRoot, 'discovery', ...args],
        {
          autohandHome: state.autohandHome,
          cwd: state.workspaceRoot,
          env: {
            AUTOHAND_API_KEY: '',
            AUTOHAND_CONFIG: '',
            AUTOHAND_DISCOVERY_CHILD: '',
            AUTOHAND_DISCOVERY_HOME: state.autohandHome,
          },
          waitForDataTimeout: 15_000,
        }
      );
      sessions.push(session);
      await waitForExit(session, 20_000);
      expect(session.exitInfo?.exitCode, session.readAll()).toBe(0);
      return session.readAll();
    }
    expect(await run(['--help'])).toContain('Discover repository workflows');
    expect(await run([])).toContain('Local drafts: 2 created');
    expect(await run(['list'])).toContain('repository-onboarding');
    expect(
      await run(['push', '--dry-run', '--select', 'repository-onboarding'])
    ).toContain('api/discovery/push');
  });
  it('shows nested projects, skills and useful workflow reasons in the built terminal', async () => {
    const state = await createTempAutohandHome({ config: { auth: undefined } });
    states.push(state);
    await mkdir(path.join(state.workspaceRoot, 'team/cli/.skills/release'), {
      recursive: true,
    });
    await writeFile(
      path.join(state.workspaceRoot, 'team/cli/package.json'),
      JSON.stringify({
        name: 'nested-terminal',
        bin: 'index.js',
        dependencies: { react: '19', ink: '7' },
      })
    );
    await writeFile(
      path.join(state.workspaceRoot, 'team/cli/.skills/release/SKILL.md'),
      '---\nname: release-readiness\ndescription: Check release readiness and packaging\n---\nInspect releases.'
    );
    const session = await launchBuiltAutohand(
      ['discovery', '--depth', '2', '--no-behavior'],
      {
        cwd: state.workspaceRoot,
        autohandHome: state.autohandHome,
        env: {
          AUTOHAND_DISCOVERY_HOME: state.autohandHome,
          AUTOHAND_DISCOVERY_CHILD: '',
          AUTOHAND_API_KEY: '',
        },
        waitForDataTimeout: 15_000,
      }
    );
    sessions.push(session);
    await waitForExit(session, 25_000);
    const screen = session.readAll();
    expect(session.exitInfo?.exitCode, screen).toBe(0);
    expect(screen).toContain('Terminal application');
    expect(screen).toContain('Suggested workflows');
    expect(screen).toContain('release-readiness');
    expect(screen).toContain('push --with-report');
    const report = JSON.parse(
      await readFile(
        path.join(state.workspaceRoot, '.autohand/discovery.json'),
        'utf8'
      )
    );
    expect(
      report.discovery.repositories.map(
        (repository: { path: string }) => repository.path
      )
    ).toContain('team/cli');
  });
  it('cancels an active upload from the progress view and exits with 130', async () => {
    const state = await createTempAutohandHome({ config: { auth: undefined } });
    states.push(state);
    await writeFile(
      path.join(state.workspaceRoot, 'package.json'),
      '{"name":"cancel-discovery"}'
    );
    const environment = {
      AUTOHAND_DISCOVERY_HOME: state.autohandHome,
      AUTOHAND_DISCOVERY_CHILD: '',
      AUTOHAND_API_KEY: 'ahc_terminal_fixture',
    };
    const scan = await launchBuiltAutohand(['discovery'], {
      cwd: state.workspaceRoot,
      autohandHome: state.autohandHome,
      env: environment,
    });
    sessions.push(scan);
    await waitForExit(scan, 20_000);
    expect(scan.exitInfo?.exitCode).toBe(0);
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local upload server address.');
    const upload = await launchBuiltAutohand(['discovery', 'push'], {
      cwd: state.workspaceRoot,
      autohandHome: state.autohandHome,
      env: {
        ...environment,
        BUILDMYAGENT_URL: `http://127.0.0.1:${address.port}`,
      },
    });
    sessions.push(upload);
    await cancelDiscoveryUpload(upload);
    await waitForExit(upload, 10_000);
    expect(upload.exitInfo?.exitCode, upload.readAll()).toBe(130);
    expect(upload.readAll()).toContain('cancelled');
  });
});
