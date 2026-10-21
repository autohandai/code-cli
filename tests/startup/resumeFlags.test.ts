import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../src/session/SessionManager.js';
import { registerResumeOptions, resolveStartupSession, validateSessionOptions } from '../../src/startup/resumeCommand.js';
import type { CLIOptions } from '../../src/types.js';

const { showModal } = vi.hoisted(() => ({ showModal: vi.fn() }));
vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal }));

describe('session startup flags', () => {
  let directory: string;
  let manager: SessionManager;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-continue-'));
    manager = new SessionManager(directory);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(directory);
  });
  function parse(args: string[]): CLIOptions {
    const program = new Command().exitOverride().option('-p, --prompt <text>');
    registerResumeOptions(program);
    program.parse(args, { from: 'user' });
    return program.opts<CLIOptions>();
  }
  async function save(project: string, activeAt: string) {
    const session = await manager.createSession(project, 'test-model');
    await session.append({ role: 'user', content: project, timestamp: activeAt });
    session.metadata.lastActiveAt = activeAt;
    await session.save();
    return session.metadata.sessionId;
  }
  it.each(['-c', '--continue'])('%s selects the latest activity in this folder, never another project', async flag => {
    const expected = await save('/project', '2026-01-05');
    await save('/project', '2026-01-03');
    await save('/other', '2026-01-06');
    const options = parse([flag, '-p', 'hi']);
    expect(await resolveStartupSession(options, '/project', { sessionManager: manager })).toBe(true);
    expect(options).toMatchObject({ resumeSessionId: expected, prompt: 'hi', autoCommit: false });
    expect(showModal).not.toHaveBeenCalled();
  });
  it('starts fresh with the specified message when only another folder has history', async () => {
    await save('/other', '2026-01-06');
    const options = parse(['-c']);
    expect(await resolveStartupSession(options, '/project', { sessionManager: manager })).toBe(true);
    expect(options.resumeSessionId).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith('No previous session in this folder, starting a new one');
  });
  it.each(['-r', '--resume'])('%s resolves an explicit session reference', async flag => {
    const expected = await save('/project', '2026-01-05');
    const options = parse([flag, expected]);
    expect(await resolveStartupSession(options, '/project', { sessionManager: manager })).toBe(true);
    expect(options.resumeSessionId).toBe(expected);
  });
  it('uses the existing folder picker and respects cancellation', async () => {
    const expected = await save('/project', '2026-01-05');
    showModal.mockResolvedValueOnce({ value: expected }).mockResolvedValueOnce(null);
    const options = parse(['-r']);
    expect(await resolveStartupSession(options, '/project', { sessionManager: manager, isInteractive: () => true })).toBe(true);
    expect(options.resumeSessionId).toBe(expected);
    expect(await resolveStartupSession(parse(['--resume']), '/project', { sessionManager: manager, isInteractive: () => true })).toBe(false);
  });
  it('keeps auto-commit long-only and never enables it with continue', () => {
    expect(parse(['--auto-commit'])).toMatchObject({ autoCommit: true });
    expect(parse(['-c'])).toMatchObject({ continue: true, autoCommit: false });
  });
  it.each([{ continue: true }, { resume: true }, { resume: 'session' }, { resumeSessionId: 'session' }, { fork: 'session' }])('rejects ephemeral restoration: %j', flags => {
    expect(validateSessionOptions({ ephemeral: true, ...flags })).toContain('--ephemeral cannot be combined');
  });
  it('rejects ambiguous startup selectors', () => {
    expect(validateSessionOptions({ continue: true, resume: true })).toContain('cannot be combined');
    expect(validateSessionOptions({ continue: true, fork: 'session' })).toContain('cannot be combined');
  });
});
