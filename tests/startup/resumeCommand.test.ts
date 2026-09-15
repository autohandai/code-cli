import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../../src/session/SessionManager.js';
import { registerResumeCommand } from '../../src/startup/resumeCommand.js';
import { resolveSessionTitle, selectResumeSession } from '../../src/commands/resume.js';
import type { ModalOption } from '../../src/ui/ink/components/Modal.js';
import type { SessionMetadata } from '../../src/session/types.js';

const { showModal } = vi.hoisted(() => ({ showModal: vi.fn() }));
vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal }));

describe('resume CLI command', () => {
  let directory: string;
  let manager: SessionManager;
  let program: Command;
  const run = vi.fn();
  const isInteractive = vi.fn(() => true);

  beforeEach(async () => {
    vi.clearAllMocks();
    isInteractive.mockReturnValue(true);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-resume-command-'));
    manager = new SessionManager(directory);
    program = new Command().exitOverride()
      .option('--config <path>')
      .option('--offline', 'Disable startup network operations', false)
      .option('-c, --auto-commit');
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerResumeCommand(program, { run, sessionManager: manager, isInteractive });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(directory);
  });

  async function savedSession(project: string, title: string, createdAt: string, lastActiveAt = createdAt) {
    const session = await manager.createSession(project, 'test-model');
    // A real message so the picker's hide-empty-sessions rule (Task 1) never
    // hides these fixtures behind the reveal row.
    await session.append({ role: 'user', content: title, timestamp: createdAt });
    Object.assign(session.metadata, { summary: title, createdAt, lastActiveAt });
    await session.save();
    return session;
  }

  const parse = (args: string[]) => program.parseAsync(['resume', ...args], { from: 'user' });

  it('opens the project picker and launches the selected canonical session', async () => {
    const session = await savedSession(process.cwd(), 'Current project', '2026-01-01');
    await savedSession('/another-project', 'Other project', '2026-01-02');
    showModal.mockResolvedValueOnce({ value: session.metadata.sessionId });

    await parse([]);

    const labels = showModal.mock.calls[0][0].options.map((option: { label: string }) => option.label);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('Current project');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: session.metadata.sessionId,
      path: process.cwd(),
    }));
  });

  it('resumes by activity within --path and supports --last --all', async () => {
    const active = await savedSession('/project', 'Older but active', '2026-01-01', '2026-01-05');
    await savedSession('/project', 'Newer but inactive', '2026-01-03');
    const other = await savedSession('/other', 'Other project', '2026-01-02', '2026-01-06');

    await parse(['--last', '--path', '/project']);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ resumeSessionId: active.metadata.sessionId }));
    await parse(['--last', '--all', '--path', '/project']);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ resumeSessionId: other.metadata.sessionId }));
    expect(showModal).not.toHaveBeenCalled();
  });

  it('shows sessions across projects with --all', async () => {
    const session = await savedSession('/another-project', 'Other project', '2026-01-01');
    showModal.mockResolvedValueOnce({ value: session.metadata.sessionId });
    await parse(['--all']);
    expect(showModal.mock.calls[0][0].options[0].label).toContain('Other project');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: session.metadata.sessionId }));
  });

  it('navigates both ways through history beyond the first twenty sessions', async () => {
    for (let index = 0; index < 21; index += 1) {
      await savedSession(process.cwd(), `Session ${index}`, '2026-01-01');
    }
    const nextPage = await manager.listRecentSessions(undefined, 20, 20);
    const selected = nextPage.sessions[0].sessionId;
    showModal.mockResolvedValueOnce({ value: '__next__' })
      .mockResolvedValueOnce({ value: '__previous__' })
      .mockResolvedValueOnce({ value: '__next__' })
      .mockResolvedValueOnce({ value: selected });

    await parse([]);

    expect(showModal.mock.calls[0][0].options).toHaveLength(21);
    expect(showModal.mock.calls[1][0].options).toHaveLength(2);
    expect(showModal.mock.calls[2][0].options).toHaveLength(21);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: selected }));
  });

  it('preserves explicit references and global runtime options', async () => {
    const session = await savedSession('/project', 'Explicit session', '2026-01-01');
    await parse([path.join(directory, session.metadata.sessionId), '--config', '/custom/config.json', '-c', '--model', 'test-override', '--offline']);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: session.metadata.sessionId,
      config: '/custom/config.json', autoCommit: true, model: 'test-override', offline: true,
    }));
    expect(showModal).not.toHaveBeenCalled();
  });

  it('leaves startup untouched on empty history and cancellation', async () => {
    await parse(['--last']);
    await parse([]);
    expect(run).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
    await savedSession(process.cwd(), 'Cancel me', '2026-01-01');
    showModal.mockResolvedValueOnce(null);
    await parse([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous reference before launching the agent', async () => {
    await fs.writeJson(path.join(directory, 'index.json'), {
      sessions: ['shared-one', 'shared-two'].map((id) => ({ id, projectPath: '/project', createdAt: '2026-01-01' })),
      byProject: { '/project': ['shared-one', 'shared-two'] },
    });
    await expect(parse(['shared-'])).rejects.toThrow('Ambiguous session reference');
    expect(run).not.toHaveBeenCalled();
  });

  it('resolves a unique abbreviated ID and rejects a missing reference', async () => {
    const session = await savedSession('/project', 'One', '2026-01-01');
    await parse([session.metadata.sessionId.slice(0, 8)]);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: session.metadata.sessionId }));
    await expect(parse(['missing-session'])).rejects.toThrow('Session not found');
    expect(run).toHaveBeenCalledOnce();
  });

  it('resumes a session by its saved name', async () => {
    const session = await savedSession('/project', 'One', '2026-01-01');
    Object.assign(session.metadata, { title: 'Caret fix', titleSource: 'user' });
    await session.save();
    await manager.closeSession();
    await parse(['caret fix']);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: session.metadata.sessionId }));
  });

  it.each(['--last', '--all'])('rejects a reference combined with %s', async (flag) => {
    await expect(parse(['session-id', flag])).rejects.toThrow('cannot be combined');
    expect(run).not.toHaveBeenCalled();
  });

  it('requires a terminal only for picking a session', async () => {
    await savedSession(process.cwd(), 'Available session', '2026-01-01');
    isInteractive.mockReturnValue(false);
    await expect(parse([])).rejects.toThrow('interactive terminal');
    expect(showModal).not.toHaveBeenCalled();
    await parse(['--last']);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('selectResumeSession picker rows', () => {
  function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
  }

  function metadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
    return {
      sessionId: overrides.sessionId ?? 'session-id',
      createdAt: overrides.createdAt ?? minutesAgo(10),
      lastActiveAt: overrides.lastActiveAt ?? overrides.createdAt ?? minutesAgo(10),
      projectPath: '/w/cli-3',
      projectName: overrides.projectName ?? 'cli-3',
      model: 'test-model',
      messageCount: overrides.messageCount ?? 1,
      status: 'completed',
      ...overrides,
    } as SessionMetadata;
  }

  function fakeManagerWith(sessions: SessionMetadata[]): SessionManager {
    return {
      listRecentSessions: vi.fn(async (_filter?: { project?: string }, limit = 20, offset = 0) => ({
        sessions: sessions.slice(offset, offset + limit),
        total: sessions.length,
      })),
    } as unknown as SessionManager;
  }

  it('lists sessions as grouped single rows and hides the empty ones', async () => {
    const shown: ModalOption[] = [];
    const manager = fakeManagerWith([
      metadata({ sessionId: 'a', messageCount: 26, lastActiveAt: minutesAgo(2) }),
      metadata({ sessionId: 'b', messageCount: 0, lastActiveAt: minutesAgo(5) }),
    ]);

    await selectResumeSession({
      sessionManager: manager,
      workspaceRoot: '/w/cli-3',
      showModal: async ({ options }) => { shown.push(...options); return { value: 'a' }; },
    });

    expect(shown.map((option) => option.value)).toEqual(['a', '__show_empty__']);
    expect(shown[0]?.header).toBe('Today');
    expect(shown[0]?.description).toBeUndefined();
  });

  it('re-opens with empty sessions after the reveal row is chosen', async () => {
    const pages: ModalOption[][] = [];
    const manager = fakeManagerWith([
      metadata({ sessionId: 'a', messageCount: 3 }),
      metadata({ sessionId: 'b', messageCount: 0 }),
    ]);
    const answers = ['__show_empty__', 'b'];

    const chosen = await selectResumeSession({
      sessionManager: manager,
      workspaceRoot: '/w/cli-3',
      showModal: async ({ options }) => { pages.push(options); return { value: answers.shift()! }; },
    });

    expect(pages[1]?.map((option) => option.value)).toEqual(['a', 'b']);
    expect(chosen).toBe('b');
  });

  it('falls back past a generic summary to the first user message', async () => {
    expect(await resolveSessionTitle(metadata({ summary: 'Session complete' }), 'fix the parser'))
      .toBe('fix the parser');
  });
});
