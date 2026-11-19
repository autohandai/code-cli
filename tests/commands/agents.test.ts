/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatActiveAgentDetails, formatActiveAgents, handler } from '../../src/commands/agents.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';
import type { LoadedConfig } from '../../src/types.js';
import { AgentRegistry } from '../../src/core/agents/AgentRegistry.js';

describe('/agents command', () => {
  it('switches orchestration persistently without changing provider/model choices', async () => {
    const config: LoadedConfig = { provider: 'autohandai', autohandai: { plan: 'cloud', model: 'moa' } };
    const persistConfig = vi.fn(async () => {});
    expect(await handler(['orchestration', 'off'], { config, persistConfig })).toContain('disabled');
    expect(config.autohandai).toMatchObject({ orchestration: false, model: 'moa' });
    expect(await handler(['orchestration', 'on'], { config, persistConfig })).toContain('enabled');
    expect(config.autohandai?.orchestration).toBe(true);
    expect(persistConfig).toHaveBeenCalledTimes(2);
    expect(await handler(['orchestration', 'bogus'], { config, persistConfig })).toContain('on|off');
    expect(persistConfig).toHaveBeenCalledTimes(2);
  });
  it('lists plain-text definitions from the active session configuration', async () => {
    const registry = AgentRegistry.getInstance();
    const previousPaths = registry.getExternalPaths();
    const config: LoadedConfig = {
      configPath: '/selected-repository/config.json',
      externalAgents: { enabled: true, paths: ['/selected-repository/agents'] },
    };
    try {
      const output = await handler(['definitions'], { config });
      expect(registry.getExternalPaths()).toEqual(['/selected-repository/agents']);
      expect(output).toContain('Sub-Agent Definitions');
      expect(output).not.toContain('🤖');
    } finally {
      registry.setExternalPaths(previousPaths);
    }
  });

  it.each([['help'], ['--help']])('documents session inspection and global heartbeat scopes for %s', async (arg) => {
    const output = await handler([arg]);
    expect(output).toContain('/agents view');
    expect(output).toContain('/agents --once');
    expect(output).toContain('/team view');
    expect(output).toContain('/squad view');
    expect(output).toContain('c cancel');
    expect(output).toContain('m message');
    expect(output).toContain('queued');
  });
  it('opens the session run inspector without entering the global heartbeat view', async () => {
    const onToggleAgentRunsView = vi.fn();
    expect(await handler(['view'], { onToggleAgentRunsView })).toContain('Session agent inspector');
    expect(onToggleAgentRunsView).toHaveBeenCalledWith(true);
  });
  it('formats the empty active agents state with the definitions hint', () => {
    const output = formatActiveAgents([]);

    expect(output).toContain('No active Autohand agents found.');
    expect(output).toContain('autohand agents definitions');
    expect(output).toContain('/agents definitions');
  });

  it('formats active agent rows', () => {
    const output = formatActiveAgents([
      createRecord({
        status: 'working',
        projectName: 'cli-3',
        sessionId: 'abcdef123456',
        model: 'openai/gpt-4o-mini',
        contextPercent: 42,
        sessionTokensUsed: 1500,
        pid: 9876,
      }),
    ], new Date('2026-01-01T00:00:05.000Z'));

    expect(output).toContain('Active Autohand Agents');
    expect(output).toContain('working');
    expect(output).toContain('cli-3');
    expect(output).toContain('abcdef12');
    expect(output).toContain('42%');
    expect(output).toContain('1.5k');
    expect(output).toContain('9876');
  });

  it('shows sanitized phase, instruction, command, and recent paths', () => {
    const output = formatActiveAgents([
      createRecord({
        activity: {
          phase: 'running_command',
          instruction: '\u001b[2JRefactor auth\u202E',
          command: 'bun test',
          pathsWritten: ['src/auth.ts', 'tests/auth.test.ts'],
        },
      }),
    ]);

    expect(output).toContain('running command');
    expect(output).toContain('Refactor auth');
    expect(output).toContain('bun test');
    expect(output).toContain('src/auth.ts');
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u202E');
  });

  it('prints a static snapshot when --once is passed', async () => {
    const registry = {
      listActive: async () => [createRecord({ sessionId: 'static123456' })],
    };

    const output = await handler(['--once'], { registry: registry as any });

    expect(output).toContain('static12');
  });

  it('saves an Autohand AI default provider and model for future teammates', async () => {
    const config: LoadedConfig = {
      configPath: '/tmp/autohand.json',
      provider: 'autohandai',
      autohandai: { plan: 'cloud', model: 'fantail' },
    };
    const persistConfig = vi.fn().mockResolvedValue(undefined);

    const output = await handler(['provider'], {
      config,
      chooseTeamProvider: vi.fn().mockResolvedValue('autohandai'),
      chooseTeamModel: vi.fn().mockResolvedValue('fantail'),
      confirmTeamModelSelection: vi.fn().mockResolvedValue(true),
      persistConfig,
    });

    expect(config.teams).toEqual({
      defaultProvider: 'autohandai',
      defaultModel: 'fantail',
    });
    expect(persistConfig).toHaveBeenCalledWith(config);
    expect(output).toContain('Autohand AI · fantail');
  });

  it('saves a named sub-agent exception without replacing the team default', async () => {
    const config: LoadedConfig = {
      configPath: '/tmp/autohand.json',
      provider: 'autohandai',
      autohandai: { plan: 'cloud', model: 'fantail' },
      teams: { defaultProvider: 'autohandai', defaultModel: 'fantail' },
    };

    await handler(['provider', 'reviewer'], {
      config,
      chooseTeamProvider: vi.fn().mockResolvedValue('anthropic'),
      chooseTeamModel: vi.fn().mockResolvedValue('claude-sonnet-5'),
      confirmTeamModelSelection: vi.fn().mockResolvedValue(true),
      persistConfig: vi.fn().mockResolvedValue(undefined),
    });

    expect(config.teams).toEqual({
      defaultProvider: 'autohandai',
      defaultModel: 'fantail',
      agentModelOverrides: {
        reviewer: { provider: 'anthropic', model: 'claude-sonnet-5' },
      },
    });
  });
});

const ARROW_UP = '\u001b[A';
const ARROW_DOWN = '\u001b[B';
const CLEAR_SCREEN = '\u001b[2J';

function liveTerminal(rows = 30) {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
  const frames: string[] = [];
  const output = { isTTY: true, rows, columns: 120, write: vi.fn((chunk: string) => { frames.push(chunk); return true; }) };
  const plain = (text: string) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '');
  return {
    stdin: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream,
    writes: frames,
    screen: () => plain(frames.filter((frame) => frame !== `${CLEAR_SCREEN}\u001b[H`).at(-1) ?? ''),
    input,
    // A lone ESC is only known to be the Escape key once nothing follows it.
    press: async (keys: string) => { input.write(keys); await vi.advanceTimersByTimeAsync(keys.endsWith('\u001b') ? 60 : 0); },
  };
}

function selectedRow(screen: string): string | undefined {
  return screen.split('\n').find((line) => line.startsWith('›'));
}

describe('/agents live session view', () => {
  afterEach(() => { vi.useRealTimers(); });

  const alpha = () => createRecord({ sessionId: 'alpha-session', projectName: 'alpha', pid: 11, startedAt: '2026-01-01T00:00:00.000Z' });
  const beta = () => createRecord({ sessionId: 'beta-session', projectName: 'beta', pid: 22, startedAt: '2026-01-01T00:01:00.000Z' });
  const gamma = () => createRecord({ sessionId: 'gamma-session', projectName: 'gamma', pid: 33, startedAt: '2026-01-01T00:02:00.000Z' });

  async function open(listActive: () => Promise<ActiveAgentRecord[]>, rows?: number) {
    vi.useFakeTimers();
    const terminal = liveTerminal(rows);
    let closed = false;
    const done = handler([], { registry: { listActive } as never, input: terminal.stdin, output: terminal.output })
      .then((result) => { closed = true; return result; });
    await vi.advanceTimersByTimeAsync(0);
    return { ...terminal, done, isClosed: () => closed };
  }

  it('moves between sessions with the arrow keys instead of closing the view', async () => {
    const view = await open(async () => [alpha(), beta(), gamma()]);
    expect(selectedRow(view.screen())).toContain('alpha');

    await view.press(ARROW_DOWN);
    expect(view.isClosed()).toBe(false);
    expect(selectedRow(view.screen())).toContain('beta');

    await view.press(ARROW_DOWN);
    await view.press(ARROW_DOWN);
    expect(selectedRow(view.screen())).toContain('gamma');

    await view.press(ARROW_UP);
    expect(selectedRow(view.screen())).toContain('beta');
    expect(view.isClosed()).toBe(false);

    await view.press('\u001b');
    await expect(view.done).resolves.toBeNull();
  });

  it('handles several keys that arrive in one chunk and ignores unrelated escape sequences', async () => {
    const view = await open(async () => [alpha(), beta(), gamma()]);
    await view.press(`${ARROW_DOWN}${ARROW_DOWN}\u001b[I\u001b[<0;10;5M`);
    expect(view.isClosed()).toBe(false);
    expect(selectedRow(view.screen())).toContain('gamma');
    await view.press('\u0003');
    await expect(view.done).resolves.toBeNull();
  });

  it('keeps the selection on the same session when a refresh reorders and extends the list', async () => {
    let records = [alpha(), beta()];
    const view = await open(async () => records);
    await view.press(ARROW_DOWN);
    expect(selectedRow(view.screen())).toContain('beta');

    records = [gamma(), { ...beta(), updatedAt: '2026-01-01T00:05:00.000Z' }, alpha()];
    await vi.advanceTimersByTimeAsync(1000);

    expect(selectedRow(view.screen())).toContain('beta');
    const order = view.screen().split('\n').filter((line) => /alpha|beta|gamma/u.test(line)).map((line) => line.match(/alpha|beta|gamma/u)?.[0]);
    expect(order).toEqual(['alpha', 'beta', 'gamma']);
    await view.press('\u0003');
    await view.done;
  });

  it('keeps a nearby session selected when the selected session ends', async () => {
    let records = [alpha(), beta(), gamma()];
    const view = await open(async () => records);
    await view.press(`${ARROW_DOWN}${ARROW_DOWN}`);
    records = [alpha(), beta()];
    await vi.advanceTimersByTimeAsync(1000);
    expect(selectedRow(view.screen())).toContain('beta');
    await view.press('\u0003');
    await view.done;
  });

  it('opens the selected session on Enter, follows it across refreshes, and returns to the list on Escape', async () => {
    let records = [alpha(), createRecord({
      ...beta(), workspaceRoot: '/work/beta', status: 'working', mode: 'command',
      activity: { phase: 'running_command', instruction: 'Fix the login flow', command: 'bun test', pathsWritten: ['src/login.ts'] },
    })];
    const view = await open(async () => records);
    await view.press(ARROW_DOWN);
    await view.press('\r');

    expect(view.screen()).toContain('Session: beta-session');
    expect(view.screen()).toContain('Workspace: /work/beta');
    expect(view.screen()).toContain('Fix the login flow');
    expect(view.screen()).toContain('src/login.ts');
    expect(view.screen()).not.toContain('alpha');

    records = [records[1]!, alpha()];
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.screen()).toContain('Session: beta-session');

    await view.press(ARROW_UP);
    expect(view.screen()).toContain('Session: alpha-session');

    await view.press('\u001b');
    expect(view.isClosed()).toBe(false);
    expect(selectedRow(view.screen())).toContain('alpha');

    await view.press('\u001b');
    await expect(view.done).resolves.toBeNull();
  });

  it('returns to the list when the opened session ends', async () => {
    let records = [alpha(), beta()];
    const view = await open(async () => records);
    await view.press(`${ARROW_DOWN}\r`);
    expect(view.screen()).toContain('Session: beta-session');
    records = [alpha()];
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.screen()).toContain('Active Autohand Agents');
    expect(selectedRow(view.screen())).toContain('alpha');
    await view.press('\u0003');
    await view.done;
  });

  it('repaints in place and only when the screen content changes', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
    const view = await open(async () => [alpha(), beta()]);
    const afterFirstPaint = view.writes.length;
    expect(view.writes.join('')).toContain(CLEAR_SCREEN);

    await vi.advanceTimersByTimeAsync(3000);
    expect(view.writes.length).toBe(afterFirstPaint);

    await view.press(ARROW_DOWN);
    expect(view.writes.length).toBe(afterFirstPaint + 1);
    expect(view.writes.slice(afterFirstPaint).join('')).not.toContain(CLEAR_SCREEN);
    await view.press('\u0003');
    await view.done;
  });

  it('keeps the selected session on screen when sessions outnumber terminal rows', async () => {
    const records = Array.from({ length: 20 }, (_, index) => createRecord({
      sessionId: `session-${String(index).padStart(2, '0')}`, projectName: `project-${String(index).padStart(2, '0')}`,
      pid: 100 + index, startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      activity: { phase: 'thinking', instruction: `Instruction ${index}`, pathsWritten: [] },
    }));
    const view = await open(async () => records, 12);
    await view.press(ARROW_DOWN.repeat(19));
    expect(selectedRow(view.screen())).toContain('project-19');
    expect(view.screen()).toContain('20/20');
    expect(view.screen().trimEnd().split('\n').length).toBeLessThanOrEqual(12);
    await view.press(ARROW_UP.repeat(19));
    expect(selectedRow(view.screen())).toContain('project-00');
    expect(view.screen().trimEnd().split('\n').length).toBeLessThanOrEqual(12);
    await view.press('\u0003');
    await view.done;
  });

  it('shows the empty state and still exits on Escape when no session is active', async () => {
    const view = await open(async () => []);
    expect(view.screen()).toContain('No active Autohand agents found.');
    await view.press(`${ARROW_DOWN}\r`);
    expect(view.isClosed()).toBe(false);
    await view.press('\u001b');
    await expect(view.done).resolves.toBeNull();
  });

  const ESCAPE_ENCODINGS = [
    ['legacy', '\u001b'],
    ['kitty', '\u001b[27u'],
    ['kitty with modifiers and event type', '\u001b[27;1:1u'],
    ['modifyOtherKeys', '\u001b[27;1;27~'],
  ] as const;
  const CTRL_C_ENCODINGS = [
    ['legacy', '\u0003'],
    ['kitty', '\u001b[99;5u'],
    ['kitty with event type', '\u001b[99;5:1u'],
    ['modifyOtherKeys', '\u001b[27;5;99~'],
  ] as const;

  it.each(ESCAPE_ENCODINGS)('returns from details to the list and then exits on %s Escape', async (_name, escape) => {
    const view = await open(async () => [alpha(), beta()]);
    await view.press(`${ARROW_DOWN}\r`);
    expect(view.screen()).toContain('Session: beta-session');

    await view.press(escape);
    expect(view.isClosed()).toBe(false);
    expect(view.screen()).toContain('Active Autohand Agents');
    expect(selectedRow(view.screen())).toContain('beta');

    await view.press(escape);
    await expect(view.done).resolves.toBeNull();
  });

  it.each(CTRL_C_ENCODINGS)('exits from the details screen on %s Ctrl+C', async (_name, ctrlC) => {
    const view = await open(async () => [alpha(), beta()]);
    await view.press('\r');
    expect(view.screen()).toContain('Session: alpha-session');
    await view.press(ctrlC);
    await expect(view.done).resolves.toBeNull();
  });

  it.each(CTRL_C_ENCODINGS)('exits from the list on %s Ctrl+C', async (_name, ctrlC) => {
    const view = await open(async () => [alpha(), beta()]);
    await view.press(ctrlC);
    await expect(view.done).resolves.toBeNull();
  });

  it('ignores protocol key-release events and unrelated protocol keys', async () => {
    const view = await open(async () => [alpha(), beta()]);
    await view.press('\r');
    await view.press('\u001b[27;1:3u\u001b[99;5:3u\u001b[97;5u\u001b[99u\u001b[?1u');
    expect(view.isClosed()).toBe(false);
    expect(view.screen()).toContain('Session: alpha-session');
    await view.press('\u0003');
    await view.done;
  });

  it.each(['list', 'details'] as const)('treats an arrow key split across chunks as an arrow on the %s screen', async (screen) => {
    const view = await open(async () => [alpha(), beta()]);
    if (screen === 'details') await view.press('\r');
    view.input.write('\u001b');
    await vi.advanceTimersByTimeAsync(10);
    view.input.write('[B');
    await vi.advanceTimersByTimeAsync(100);

    expect(view.isClosed()).toBe(false);
    if (screen === 'details') expect(view.screen()).toContain('Session: beta-session');
    else expect(selectedRow(view.screen())).toContain('beta');
    await view.press('\u0003');
    await view.done;
  });

  it('restores the terminal input state and stops refreshing after exit', async () => {
    const view = await open(async () => [alpha()]);
    const setRawMode = (view.stdin as unknown as { setRawMode: ReturnType<typeof vi.fn> }).setRawMode;
    expect(setRawMode).toHaveBeenLastCalledWith(true);
    await view.press('\r');
    await view.press('\u001b[99;5u');
    await view.done;

    expect(setRawMode).toHaveBeenLastCalledWith(false);
    expect(view.input.listenerCount('data')).toBe(0);
    expect(view.writes.at(-1)).toContain('\u001b[?25h');
    const writes = view.writes.length;
    view.input.write('\u001b');
    await vi.advanceTimersByTimeAsync(5000);
    expect(view.writes.length).toBe(writes);
  });

  it('sanitizes session details published by other processes', () => {
    const output = formatActiveAgentDetails(createRecord({
      workspaceRoot: '/repo\u001b[2J‮', activity: { phase: 'editing', instruction: 'Edit\u001b[2J', pathsWritten: [] },
    }));
    expect(output).toContain('Workspace: /repo');
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('‮');
  });
});

function createRecord(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 123,
    sessionId: 'session-id',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    mode: 'interactive',
    status: 'idle',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 2,
    contextPercent: 87,
    tokensUsed: 1234,
    tokensUsageStatus: 'actual',
    sessionTokensUsed: 1234,
    ...overrides,
  };
}
