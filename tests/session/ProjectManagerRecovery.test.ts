import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { ProjectManager } from '../../src/session/ProjectManager.js';
import type { FailureRecord, SuccessRecord } from '../../src/session/types.js';

const temporary: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(temporary.splice(0).map(directory => fs.remove(directory)));
});

const failure: FailureRecord = {
  timestamp: new Date().toISOString(), sessionId: 'previous-session', tool: 'read_file',
  error: 'missing fixture', context: 'fixture', tags: ['typescript'],
};
const success: SuccessRecord = {
  timestamp: new Date().toISOString(), sessionId: 'current-session', tool: 'list_tree',
  context: 'fixture', tags: ['bun'],
};

async function fixture(): Promise<{ manager: ProjectManager; workspace: string; directory: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-log-recovery-'));
  temporary.push(root);
  const manager = new ProjectManager(path.join(root, 'projects'));
  const workspace = path.join(root, 'workspace');
  const hash = await manager.getOrCreateProject(workspace);
  return { manager, workspace, directory: path.join(root, 'projects', hash) };
}

describe('project event-log recovery', () => {
  it('records a success despite a malformed historical failure row without rewriting the log', async () => {
    const { manager, workspace, directory } = await fixture();
    const original = `${JSON.stringify(failure)}\n{"tool":"interrupted\n`;
    await fs.writeFile(path.join(directory, 'failures.jsonl'), original);
    await expect(manager.recordSuccess(workspace, success)).resolves.toBeUndefined();
    expect(await manager.getKnowledge(workspace)).toMatchObject({
      sessionCount: 2, summary: 'Project has 1 successful operations across 1 tools.',
      techStack: { languages: ['typescript'], tools: ['bun'] },
    });
    expect(await fs.readFile(path.join(directory, 'failures.jsonl'), 'utf8')).toBe(original);
  });

  it('keeps the next valid success separate from an interrupted row at end of file', async () => {
    const { manager, workspace, directory } = await fixture();
    const previous = { ...success, sessionId: 'previous-session', tool: 'read_file' };
    const original = `${JSON.stringify(previous)}\n{"timestamp":"unfinished`;
    const log = path.join(directory, 'successes.jsonl');
    await fs.writeFile(log, original);
    await expect(manager.recordSuccess(workspace, success)).resolves.toBeUndefined();
    expect(await fs.readFile(log, 'utf8')).toBe(`${original}\n${JSON.stringify(success)}\n`);
    expect(await manager.getKnowledge(workspace)).toMatchObject({
      sessionCount: 2, summary: 'Project has 2 successful operations across 2 tools.',
    });
  });

  it('recovers recent failures and duplicate detection around malformed rows', async () => {
    const { manager, workspace, directory } = await fixture();
    const second = { ...failure, command: 'bun test', sessionId: 'second-session' };
    const original = `${JSON.stringify(failure)}\nnot-json\n\n${JSON.stringify(second)}\n{"error":`;
    await fs.writeFile(path.join(directory, 'failures.jsonl'), original);
    await expect(manager.getRecentFailures(workspace)).resolves.toEqual([failure, second]);
    await expect(manager.isDuplicateFailure(workspace, 'read_file', 'bun test')).resolves.toEqual(second);
    expect(await fs.readFile(path.join(directory, 'failures.jsonl'), 'utf8')).toBe(original);
  });

  it('separates a new failure from an unterminated historical row', async () => {
    const { manager, workspace, directory } = await fixture();
    const log = path.join(directory, 'failures.jsonl');
    await fs.writeFile(log, '{"error":"unfinished');
    await expect(manager.recordFailure(workspace, failure)).resolves.toBeUndefined();
    await expect(manager.getRecentFailures(workspace)).resolves.toEqual([failure]);
  });

  it('preserves a valid final row without a newline and keeps normal append formatting', async () => {
    const { manager, workspace, directory } = await fixture();
    const log = path.join(directory, 'successes.jsonl');
    const previous = { ...success, sessionId: 'previous-session' };
    await fs.writeFile(log, JSON.stringify(previous));
    await manager.recordSuccess(workspace, success);
    await manager.recordSuccess(workspace, success);
    expect(await fs.readFile(log, 'utf8')).toBe(
      `${JSON.stringify(previous)}\n${JSON.stringify(success)}\n${JSON.stringify(success)}\n`,
    );
    expect(await manager.getKnowledge(workspace)).toMatchObject({
      sessionCount: 2, summary: 'Project has 3 successful operations across 1 tools.',
    });
  });

  it('does not hide storage errors or retain timers after reading a damaged log', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const { manager, workspace, directory } = await fixture();
    await fs.writeFile(path.join(directory, 'failures.jsonl'), 'not-json\n');
    await manager.recordSuccess(workspace, success);
    expect(vi.getTimerCount()).toBe(baseline);
    const denied = Object.assign(new Error('fixture storage denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(denied);
    await expect(manager.getRecentFailures(workspace)).rejects.toBe(denied);
  });
});
