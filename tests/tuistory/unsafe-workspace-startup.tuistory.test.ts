import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { Session } from 'tuistory';
import { readUnsafeWorkspaceStartup } from '../../src/testing/scenarios/unsafeWorkspaceStartupScenario.js';
import {
  createTempAutohandHome,
  launchBuiltAutohand,
  waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launchUnsafeWorkspace(workspace: string, args: string[] = []): Promise<Session> {
  const state = await createTempAutohandHome();
  states.push(state);
  const session = await launchBuiltAutohand([
    ...args, '--config', state.configPath, '--path', workspace,
  ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
  sessions.push(session);
  return session;
}

async function expectWorkspaceWarning(session: Session): Promise<void> {
  const output = await readUnsafeWorkspaceStartup(session);
  await waitForExit(session);
  expect(session.exitInfo?.exitCode).toBe(1);
  expect(output).toContain('Please navigate to a specific project folder');
  expect(output).not.toMatch(/EPERM|EACCES|Cannot access workspace|Setup cancelled/);
}

describe('unsafe workspace startup Tuistory', () => {
  it.each([{ args: [] }, { args: ['--setup'] }])('rejects the system root before permission checks and setup with $args', async ({ args }) => {
    const root = path.parse(os.homedir()).root;
    await expectWorkspaceWarning(await launchUnsafeWorkspace(root, args));
  });

  it.runIf(process.platform === 'win32')('rejects System32 before creating project state', async () => {
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
    const system32 = path.win32.join(systemRoot, 'System32');
    await expectWorkspaceWarning(await launchUnsafeWorkspace(system32));
  });
});
