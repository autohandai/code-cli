/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import stripAnsi from 'strip-ansi';
import {
  createTempAutohandHome, launchBuiltAutohand, waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launch(args: string[]) {
  const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
  states.push(state);
  const session = await launchBuiltAutohand(['doctor', ...args, '--config', state.configPath, '--path', state.workspaceRoot], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 20_000,
  });
  sessions.push(session);
  return { state, session };
}

describe('doctor command Tuistory', () => {
  it('prints every section for a fresh install and exits by its verdict', async () => {
    const { session, state } = await launch(['--skip-mcp']);
    await waitForExit(session, 40_000);
    const output = stripAnsi(session.readAll());
    for (const title of ['Runtime', 'Configuration', 'Tools', 'Workspace', 'Terminal', 'Authentication', 'MCP servers', 'Extensions']) {
      expect(output).toContain(title);
    }
    expect(output).toContain(state.configPath);
    expect(output).toMatch(/Ready|need attention/);
    expect(session.exitInfo?.exitCode).toBe(/need attention/.test(output) ? 1 : 0);
  });

  it('emits a JSON report whose verdict matches the exit code', async () => {
    const { session } = await launch(['--json', '--skip-mcp']);
    await waitForExit(session, 40_000);
    const raw = stripAnsi(session.readAll());
    const report = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { ok: boolean; sections: Array<{ title: string; items: Array<{ status: string }> }> };
    expect(report.sections.map((section) => section.title)).toContain('Configuration');
    expect(report.sections.find((section) => section.title === 'MCP servers')?.items[0]).toMatchObject({ status: 'ok' });
    expect(session.exitInfo?.exitCode).toBe(report.ok ? 0 : 1);
  });

  it('layers --profile and --set onto the run and leaves the config file untouched', async () => {
    const state = await createTempAutohandHome({ config: {
      ui: { promptSuggestions: false },
      profiles: { alt: { openrouter: { model: 'profile-model-for-doctor' } } },
    } });
    states.push(state);
    const before = await (await import('fs-extra')).default.readFile(state.configPath, 'utf8');
    const session = await launchBuiltAutohand([
      'doctor', '--json', '--skip-mcp', '--profile', 'alt', '--set', 'provider=openrouter',
      '--config', state.configPath, '--path', state.workspaceRoot,
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 20_000 });
    sessions.push(session);
    await waitForExit(session, 40_000);
    const raw = stripAnsi(session.readAll());
    const report = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { sections: Array<{ title: string; items: Array<{ name: string; detail: string }> }> };
    const provider = report.sections.find((section) => section.title === 'Configuration')?.items.find((item) => item.name === 'Provider');
    expect(provider?.detail).toBe('openrouter · profile-model-for-doctor');
    expect(await (await import('fs-extra')).default.readFile(state.configPath, 'utf8')).toBe(before);

    const unknown = await launchBuiltAutohand(['doctor', '--profile', 'missing', '--config', state.configPath, '--path', state.workspaceRoot], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 20_000,
    });
    sessions.push(unknown);
    await waitForExit(unknown, 40_000);
    expect(stripAnsi(unknown.readAll())).toContain('Available profiles: alt');
    expect(unknown.exitInfo?.exitCode).toBe(1);
  });

  it('documents the command in root help', async () => {
    const session = await launchBuiltAutohand(['--help'], { waitForDataTimeout: 15_000 });
    sessions.push(session);
    await waitForExit(session, 20_000);
    expect(stripAnsi(session.readAll())).toContain('doctor');
  });
});
