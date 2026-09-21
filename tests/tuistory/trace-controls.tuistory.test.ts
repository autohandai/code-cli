/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  launchBuiltAutohand,
  type TuistoryTempState,
  waitForExit,
} from './helpers/autohandTuistory.js';
import { selectModalOptionByLabel } from './helpers/builtCli.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

describe('trace control flags', () => {
  it('withdraws consent and exits without starting an interactive session', async () => {
    const state = await createTempAutohandHome({
      config: {
        traces: {
          enabled: true,
          cloudSync: true,
          contentMode: 'full',
          discoveryMap: true,
        },
      },
    });
    states.push(state);

    const session = await launchBuiltAutohand([
      '--bare',
      '--traces-off',
      '--config', state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForData: false,
    });
    sessions.push(session);
    await waitForExit(session);

    expect(await session.readAll()).toContain('Agent traces are off');
    expect(JSON.parse(await readFile(state.configPath, 'utf8'))).toMatchObject({
      traces: {
        enabled: false,
        cloudSync: false,
        contentMode: 'metadata',
        consentVersion: 1,
      },
    });
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 30_000);

  it('supports the traces subcommand used through autohand and ah aliases', async () => {
    const state = await createTempAutohandHome({
      config: {
        traces: {
          enabled: true,
          cloudSync: true,
          contentMode: 'metadata',
          discoveryMap: true,
        },
      },
    });
    states.push(state);

    const session = await launchBuiltAutohand([
      '--bare',
      '--config', state.configPath,
      'traces', 'off',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForData: false,
    });
    sessions.push(session);
    await waitForExit(session);

    expect(await session.readAll()).toContain('Agent traces are off');
    expect(JSON.parse(await readFile(state.configPath, 'utf8'))).toMatchObject({
      traces: { enabled: false, cloudSync: false, consentVersion: 1 },
    });
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 30_000);

  it('asks an existing user for versioned consent before entering the agent', async () => {
    const state = await createTempAutohandHome({ config: { traces: {} } });
    states.push(state);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await selectModalOptionByLabel(session, 'Disabled');
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(state.configPath, 'utf8'))).toMatchObject({
        traces: { consentVersion: 1, enabled: false, cloudSync: false },
      });
    });

    const output = session.getRawOutput();
    expect(output).toContain('https://console.autohand.ai/traces');
    expect(output).toContain('does not count against your Autohand API usage');
    expect(output).toContain('autohand --traces-off');
    expect(output).toContain('ahtraces off');

    session.close();
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
