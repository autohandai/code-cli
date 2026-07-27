/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import type { AgentRuntime } from '../../src/types.js';
import type { PeerWarning } from '../../src/session/peers/index.js';

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/actions/command.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/actions/command.js')>();
  return { ...original, runCommand: runCommandMock };
});

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-peer-executor-'));
  runCommandMock.mockReset();
  runCommandMock.mockResolvedValue({
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
  });
});

afterEach(async () => {
  await fse.remove(workspaceRoot);
});

function createExecutor(options: {
  warnings?: PeerWarning[];
  yes?: boolean;
  dryRun?: boolean;
  confirm?: (message: string) => Promise<boolean>;
} = {}) {
  const emitted: PeerWarning[] = [];
  const adoptRepoBaseline = vi.fn(async () => {});
  const recordRead = vi.fn();
  const recordWrite = vi.fn();
  const toolActivity: Array<{ tool?: string; command?: string }> = [];
  const peerAwareness = {
    warnForCommand: vi.fn(() => options.warnings ?? []),
    warnForWrite: vi.fn(() => options.warnings ?? []),
    adoptRepoBaseline,
    recordRead,
    recordWrite,
  };
  const confirmDangerousAction = vi.fn(options.confirm ?? (async () => true));
  const executor = new ActionExecutor({
    runtime: {
      workspaceRoot,
      config: {},
      options: { yes: options.yes, dryRun: options.dryRun },
    } as AgentRuntime,
    files: new FileActionManager(workspaceRoot),
    resolveWorkspacePath: (relativePath) => path.resolve(workspaceRoot, relativePath),
    confirmDangerousAction,
    peerAwareness,
    onPeerWarning: (warning) => emitted.push(warning),
    onToolActivity: (activity) => toolActivity.push(activity ?? {}),
  });
  return {
    executor,
    peerAwareness,
    emitted,
    adoptRepoBaseline,
    recordRead,
    recordWrite,
    confirmDangerousAction,
    toolActivity,
  };
}

describe('ActionExecutor peer awareness', () => {
  it('warns before a git mutation and adopts the resulting repository baseline', async () => {
    const warning: PeerWarning = { kind: 'git-mutation', message: 'peer active' };
    const fixture = createExecutor({ warnings: [warning] });

    await fixture.executor.execute({
      type: 'run_command',
      command: 'git commit -m x',
    }, { approvalHandled: true });

    expect(fixture.emitted).toEqual([warning]);
    expect(fixture.adoptRepoBaseline).toHaveBeenCalledOnce();
    expect(fixture.toolActivity).toEqual([
      { tool: 'run_command', command: 'git commit -m x' },
      {},
    ]);
  });

  it('does not adopt repository drift when a git mutation never executes', async () => {
    const fixture = createExecutor({ dryRun: true });

    await fixture.executor.execute({
      type: 'run_command',
      command: 'git commit -m x',
    }, { approvalHandled: true });

    expect(runCommandMock).not.toHaveBeenCalled();
    expect(fixture.adoptRepoBaseline).not.toHaveBeenCalled();
  });

  it('records explicit file reads and successful writes', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'src.ts'), 'before');
    const fixture = createExecutor();

    await fixture.executor.execute({ type: 'read_file', path: 'src.ts' });
    await fixture.executor.execute({
      type: 'write_file',
      path: 'src.ts',
      content: 'after',
    }, { approvalHandled: true });

    expect(fixture.recordRead).toHaveBeenCalledWith('src.ts', expect.any(Number));
    expect(fixture.recordWrite).toHaveBeenCalledWith('src.ts');
  });

  it('asks before a coordinate claim conflict and cancels a denied write', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'src.ts'), 'before');
    const warning: PeerWarning = {
      kind: 'claim-conflict',
      message: 'src.ts is claimed by another session',
    };
    const fixture = createExecutor({
      warnings: [warning],
      confirm: async () => false,
    });

    const output = await fixture.executor.execute({
      type: 'write_file',
      path: 'src.ts',
      content: 'after',
    }, { approvalHandled: true });

    expect(output).toContain('Skipped');
    expect(await fse.readFile(path.join(workspaceRoot, 'src.ts'), 'utf8')).toBe('before');
    expect(fixture.emitted).toEqual([warning]);
    expect(fixture.confirmDangerousAction).toHaveBeenCalledOnce();
  });

  it('still emits a claim warning but does not prompt under --yes', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'src.ts'), 'before');
    const warning: PeerWarning = {
      kind: 'claim-conflict',
      message: 'src.ts is claimed by another session',
    };
    const fixture = createExecutor({
      warnings: [warning],
      yes: true,
      confirm: async () => false,
    });

    await fixture.executor.execute({
      type: 'write_file',
      path: 'src.ts',
      content: 'after',
    }, { approvalHandled: true });

    expect(await fse.readFile(path.join(workspaceRoot, 'src.ts'), 'utf8')).toBe('after');
    expect(fixture.emitted).toEqual([warning]);
    expect(fixture.confirmDangerousAction).not.toHaveBeenCalled();
  });
});
