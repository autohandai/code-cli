import { describe, expect, it, vi } from 'vitest';
import { cloudCommand, openCloudSession } from '../../src/commands/cloud.js';
import { SessionManager } from '../../src/session/SessionManager.js';
import type { LoadedConfig } from '../../src/types.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import { ChildProcess, spawn } from 'node:child_process';

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }));

const config: LoadedConfig = { configPath: '/fixture/config.json', auth: { token: 'fixture-token', user: { id: 'ada', email: 'ada@autohand.test', name: 'Ada' } } };
describe('cloud slash commands', () => {
  it('preserves the current read-only interaction mode when moving to Cloud', async () => {
    const launch = vi.fn().mockResolvedValue({ kind: 'cancelled' });
    await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session'), getInteractionMode: () => 'plan' }, ['Inspect parser'], { launch });
    expect(launch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ plan: true }));
  });
  it('starts a nested local continuation in the returned read-only plan mode and releases its exit listener', async () => {
    const child = new ChildProcess();
    vi.mocked(spawn).mockImplementationOnce(() => { queueMicrotask(() => child.emit('close', 0, null)); return child; });
    const exits = process.listenerCount('exit');
    await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session') }, [], { launch: vi.fn().mockResolvedValue({ kind: 'local', transferId: '11111111-1111-4111-8111-111111111111', accountId: 'personal_fixture', plan: true }) });
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toContain('--plan');
    expect(process.listenerCount('exit')).toBe(exits);
    expect(child.eventNames()).toEqual([]);
  });
  it('registers /cloud and /handoff cloud for interactive discovery', () => {
    expect(SLASH_COMMANDS.map(command => command.command)).toContain('/cloud');
    expect(SLASH_COMMANDS.map(command => command.command)).toContain('/handoff cloud');
  });
  it('pauses local terminal ownership while cloud view is active and always restores it', async () => {
    const before = vi.fn(), after = vi.fn(), launch = vi.fn().mockRejectedValue(new Error('Cloud unavailable'));
    const result = await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session'), onBeforeModal: before, onAfterModal: after }, [], { launch });
    expect(result).toContain('Cloud unavailable'); expect(before).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledOnce();
  });
  it('restores terminal ownership when the pause hook fails', async () => {
    const after = vi.fn(), launch = vi.fn();
    const result = await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session'), onBeforeModal: async () => { throw new Error('Could not pause'); }, onAfterModal: after }, [], { launch });
    expect(result).toContain('Could not pause'); expect(after).toHaveBeenCalledOnce(); expect(launch).not.toHaveBeenCalled();
  });
  it('opens the last cloud session in Desktop after returning to the local composer', async () => {
    const sessionManager = new SessionManager('/fixture/session');
    const id = '11111111-1111-4111-8111-111111111111';
    await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager }, [], { launch: vi.fn().mockResolvedValue({ kind: 'detached', conversationId: id, accountId: 'personal_fixture' }) });
    const open = vi.fn().mockResolvedValue(undefined);
    expect(await openCloudSession({ config, sessionManager }, ['desktop'], open)).toBe(`autohand://cloud/session/${id}?account=personal_fixture`);
    expect(open).toHaveBeenCalledOnce();
  });
  it('refuses to launch from protocol modes and does not upload context on /cloud', async () => {
    const launch = vi.fn().mockResolvedValue({ kind: 'detached' });
    expect(await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session'), isNonInteractive: true }, [], { launch })).toContain('interactive');
    expect(launch).not.toHaveBeenCalled();
    await cloudCommand({ config, workspaceRoot: '/fixture/parser', sessionManager: new SessionManager('/fixture/session') }, ['Repair', 'parser'], { launch });
    expect(launch.mock.calls[0][0].snapshot).toBeUndefined();
    expect(launch.mock.calls[0][1]).toMatchObject({ cloud: true, prompt: 'Repair parser' });
  });
});
