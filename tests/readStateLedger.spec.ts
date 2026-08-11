/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import { ReadSessionLedger } from '../src/core/agent/ReadSessionLedger.js';
import { SessionManager } from '../src/session/SessionManager.js';
import type { SessionReadFileState } from '../src/session/types.js';
import type { AgentAction, AgentRuntime } from '../src/types.js';

describe('stateful read ledger', () => {
  let workspaceRoot: string;
  let sessionsRoot: string;
  let sessionManager: SessionManager;
  let previousDisableStatefulRead: string | undefined;

  beforeEach(async () => {
    previousDisableStatefulRead = process.env.AUTOHAND_DISABLE_STATEFUL_READ;
    workspaceRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-read-ledger-workspace-'));
    sessionsRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-read-ledger-sessions-'));
    sessionManager = new SessionManager(sessionsRoot);
    await sessionManager.initialize();
    await sessionManager.createSession(workspaceRoot, 'test-model');
  });

  afterEach(async () => {
    if (previousDisableStatefulRead === undefined) {
      delete process.env.AUTOHAND_DISABLE_STATEFUL_READ;
    } else {
      process.env.AUTOHAND_DISABLE_STATEFUL_READ = previousDisableStatefulRead;
    }
    await Promise.all([
      fse.remove(workspaceRoot),
      fse.remove(sessionsRoot),
    ]);
  });

  function createExecutor(
    features: Record<string, boolean>,
    options: AgentRuntime['options'] = {},
  ): ActionExecutor {
    return new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: { features },
        options,
      } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
      readStateStore: {
        getCurrentSession: () => sessionManager.getCurrentSession(),
      },
    });
  }

  it('records a complete model-visible read without changing ledger-only output', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'complete.txt'), 'alpha\nbeta\n');
    const executor = createExecutor({ readStateLedger: true });

    const first = await executor.executeForTool({
      type: 'read_file',
      path: 'complete.txt',
    }, { approvalHandled: true });
    const second = await executor.executeForTool({
      type: 'read_file',
      path: 'complete.txt',
    }, { approvalHandled: true });

    expect(first).toEqual({
      success: true,
      output: '     1\talpha\n     2\tbeta',
    });
    expect(second).toEqual(first);

    const canonicalPath = await fse.realpath(path.join(workspaceRoot, 'complete.txt'));
    const state = sessionManager.getCurrentSession()?.getReadFileState();
    expect(state).toMatchObject({
      schemaVersion: 1,
      entries: [{
        path: canonicalPath,
        coverage: [{ startLine: 0, endLineExclusive: 2 }],
        totalLines: 2,
        complete: true,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }],
    });
  });

  it('merges complete visible-line coverage across unchanged windows', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'paged.txt'), 'alpha\nbeta\ngamma\ndelta');
    const executor = createExecutor({ readStateLedger: true });

    await executor.executeForTool({
      type: 'read_file',
      path: 'paged.txt',
      limit: 2,
    }, { approvalHandled: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'paged.txt',
      offset: 2,
      limit: 2,
    }, { approvalHandled: true });

    expect(sessionManager.getCurrentSession()?.getReadFileState()?.entries[0]).toMatchObject({
      coverage: [{ startLine: 0, endLineExclusive: 4 }],
      totalLines: 4,
      complete: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('does not count a clamped source line as complete coverage', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'clamped.txt'), `${'x'.repeat(2_001)}\ntail`);
    const executor = createExecutor({ readStateLedger: true });

    await executor.executeForTool({
      type: 'read_file',
      path: 'clamped.txt',
    }, { approvalHandled: true });

    expect(sessionManager.getCurrentSession()?.getReadFileState()?.entries[0]).toMatchObject({
      coverage: [{ startLine: 1, endLineExclusive: 2 }],
      totalLines: 2,
      complete: false,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('does not authorize a text read that required invalid UTF-8 replacement', async () => {
    const target = path.join(workspaceRoot, 'invalid-utf8.txt');
    await fse.writeFile(target, Buffer.from([0x61, 0x80, 0x62]));
    const executor = createExecutor({ readBeforeWrite: true });

    const read = await executor.executeForTool({
      type: 'read_file',
      path: 'invalid-utf8.txt',
    }, { approvalHandled: true });
    const write = await executor.executeForTool({
      type: 'write_file',
      path: 'invalid-utf8.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(read).toEqual({ success: true, output: '     1\ta�b' });
    expect(sessionManager.getCurrentSession()?.getReadFileState()?.entries[0]).toMatchObject({
      complete: false,
    });
    expect(write).toMatchObject({
      success: false,
      error: expect.stringContaining('Only part of invalid-utf8.txt has been read'),
    });
    expect(await fse.readFile(target)).toEqual(Buffer.from([0x61, 0x80, 0x62]));
  });

  it('restores ledger state when the same session resumes', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'resume.txt'), 'persisted');
    const sessionId = sessionManager.getCurrentSession()!.metadata.sessionId;
    const executor = createExecutor({ readStateLedger: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'resume.txt',
    }, { approvalHandled: true });

    const resumedManager = new SessionManager(sessionsRoot);
    await resumedManager.initialize();
    const resumed = await resumedManager.loadSession(sessionId);

    expect(resumed.getReadFileState()?.entries[0]).toMatchObject({
      complete: true,
      totalLines: 1,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it('keeps legacy sessions free of read state when all experiments are off', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'legacy.txt'), 'unchanged behavior');
    const executor = createExecutor({});

    const outcome = await executor.executeForTool({
      type: 'read_file',
      path: 'legacy.txt',
    }, { approvalHandled: true });

    expect(outcome).toEqual({ success: true, output: '     1\tunchanged behavior' });
    expect(sessionManager.getCurrentSession()?.getReadFileState()).toBeNull();
  });

  it('consumes an unchanged complete-read dedup hit so the next retry returns content', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'dedup.txt'), 'alpha\nbeta');
    const executor = createExecutor({ readStateDedup: true });

    const first = await executor.executeForTool({
      type: 'read_file',
      path: 'dedup.txt',
    }, { approvalHandled: true });
    const second = await executor.executeForTool({
      type: 'read_file',
      path: 'dedup.txt',
    }, { approvalHandled: true });
    const third = await executor.executeForTool({
      type: 'read_file',
      path: 'dedup.txt',
    }, { approvalHandled: true });

    expect(first).toEqual({ success: true, output: '     1\talpha\n     2\tbeta' });
    expect(second).toEqual({
      success: true,
      output: 'Note: dedup.txt is unchanged since the previous read (offset=0, limit=2000). Repeat the same read_file call to resend the full content.',
    });
    expect(third).toEqual(first);
  });

  it('does not stub a repeated offset-zero read while the ledger is partial', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'partial.txt'), 'one\ntwo\nthree');
    const executor = createExecutor({ readStateDedup: true });

    const first = await executor.executeForTool({
      type: 'read_file',
      path: 'partial.txt',
      limit: 1,
    }, { approvalHandled: true });
    const second = await executor.executeForTool({
      type: 'read_file',
      path: 'partial.txt',
      limit: 1,
    }, { approvalHandled: true });

    expect(second).toEqual(first);
    expect(second.success ? second.output : '').toContain('     1\tone');
    expect(second.success ? second.output : '').not.toContain('is unchanged');
  });

  it('returns current content instead of a dedup stub after the file changes', async () => {
    const target = path.join(workspaceRoot, 'changed.txt');
    await fse.writeFile(target, 'before');
    const executor = createExecutor({ readStateDedup: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'changed.txt',
    }, { approvalHandled: true });

    await fse.writeFile(target, 'after with a different size');
    const outcome = await executor.executeForTool({
      type: 'read_file',
      path: 'changed.txt',
    }, { approvalHandled: true });

    expect(outcome).toEqual({
      success: true,
      output: '     1\tafter with a different size',
    });
  });

  it('deduplicates a repeated nonzero partial window and then restores its content', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'window.txt'), 'zero\none\ntwo');
    const executor = createExecutor({ readStateDedup: true });
    const action = {
      type: 'read_file' as const,
      path: 'window.txt',
      offset: 1,
      limit: 1,
    };

    const first = await executor.executeForTool(action, { approvalHandled: true });
    const second = await executor.executeForTool(action, { approvalHandled: true });
    const third = await executor.executeForTool(action, { approvalHandled: true });

    expect(first.success ? first.output : '').toContain('     2\tone');
    expect(second).toEqual({
      success: true,
      output: 'Note: window.txt is unchanged since the previous read (offset=1, limit=1). Repeat the same read_file call to resend the full content.',
    });
    expect(third).toEqual(first);
  });

  it('restores an eligible dedup record when the same session resumes', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'resume-dedup.txt'), 'persisted content');
    const sessionId = sessionManager.getCurrentSession()!.metadata.sessionId;
    const firstExecutor = createExecutor({ readStateDedup: true });
    await firstExecutor.executeForTool({
      type: 'read_file',
      path: 'resume-dedup.txt',
    }, { approvalHandled: true });

    const resumedManager = new SessionManager(sessionsRoot);
    await resumedManager.initialize();
    await resumedManager.loadSession(sessionId);
    sessionManager = resumedManager;
    const resumedExecutor = createExecutor({ readStateDedup: true });
    const outcome = await resumedExecutor.executeForTool({
      type: 'read_file',
      path: 'resume-dedup.txt',
    }, { approvalHandled: true });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: resume-dedup.txt is unchanged since the previous read (offset=0, limit=2000). Repeat the same read_file call to resend the full content.',
    });
  });

  it('lets the emergency switch restore full legacy reads without changing config', async () => {
    process.env.AUTOHAND_DISABLE_STATEFUL_READ = '1';
    await fse.writeFile(path.join(workspaceRoot, 'escape.txt'), 'always visible');
    const executor = createExecutor({
      readStateLedger: true,
      readStateDedup: true,
      readBeforeWrite: true,
    });

    const first = await executor.executeForTool({
      type: 'read_file',
      path: 'escape.txt',
    }, { approvalHandled: true });
    const second = await executor.executeForTool({
      type: 'read_file',
      path: 'escape.txt',
    }, { approvalHandled: true });

    expect(second).toEqual(first);
    expect(sessionManager.getCurrentSession()?.getReadFileState()).toBeNull();
  });

  it('blocks an unread existing-file overwrite when enforcement is enabled', async () => {
    const target = path.join(workspaceRoot, 'unread.txt');
    await fse.writeFile(target, 'original');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'unread.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringMatching(/unread\.txt has not been read in this session[\s\S]*read_file/u),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('original');
  });

  it('distinguishes a partial read from a missing read before overwrite', async () => {
    const target = path.join(workspaceRoot, 'partly-read.txt');
    await fse.writeFile(target, 'one\ntwo\nthree');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'partly-read.txt',
      limit: 1,
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'partly-read.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('Only part of partly-read.txt has been read in this session'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('one\ntwo\nthree');
  });

  it('allows an overwrite after a complete unchanged read', async () => {
    const target = path.join(workspaceRoot, 'read-first.txt');
    await fse.writeFile(target, 'original');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'read-first.txt',
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'read-first.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('replacement');
  });

  it('blocks a stale overwrite when same-sized bytes changed after the read', async () => {
    const target = path.join(workspaceRoot, 'stale.txt');
    await fse.writeFile(target, 'alpha');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'stale.txt',
    }, { approvalHandled: true });
    await fse.writeFile(target, 'bravo');

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'stale.txt',
      contents: 'third',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('stale.txt changed after it was read'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('bravo');
  });

  it('allows new-file creation without a synthetic prior read', async () => {
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'new.txt',
      contents: 'created',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(path.join(workspaceRoot, 'new.txt'), 'utf8')).toBe('created');
  });

  it.each([
    ['append_file', { type: 'append_file', path: 'target.txt', contents: ' appended' }],
    ['apply_patch', { type: 'apply_patch', path: 'target.txt', patch: 'nonempty patch' }],
    ['search_replace', {
      type: 'search_replace',
      path: 'target.txt',
      blocks: '<<<<<<< SEARCH\nhello\n=======\ngoodbye\n>>>>>>> REPLACE',
    }],
    ['format_file', { type: 'format_file', path: 'target.txt', formatter: 'prettier' }],
    ['multi_file_edit', {
      type: 'multi_file_edit',
      file_path: 'target.txt',
      edits: [{ old_string: 'hello', new_string: 'goodbye' }],
    }],
    ['delete_path', { type: 'delete_path', path: 'target.txt' }],
  ] satisfies Array<[string, AgentAction]>)('guards %s before it mutates an existing file', async (_name, action) => {
    const target = path.join(workspaceRoot, 'target.txt');
    await fse.writeFile(target, 'hello world');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool(action, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('target.txt has not been read in this session'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('hello world');
  });

  it('guards notebook_edit before changing an existing notebook', async () => {
    const target = path.join(workspaceRoot, 'analysis.ipynb');
    await fse.writeJson(target, {
      nbformat: 4,
      cells: [{ cell_type: 'markdown', source: 'before', metadata: {} }],
      metadata: {},
    });
    const before = await fse.readFile(target, 'utf8');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'notebook_edit',
      path: 'analysis.ipynb',
      cell_index: 0,
      new_source: 'after',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('analysis.ipynb has not been read in this session'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe(before);
  });

  it('guards the source removed by rename_path', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'source.txt'), 'source');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'rename_path',
      from: 'source.txt',
      to: 'renamed.txt',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('source.txt has not been read in this session'),
    });
    expect(await fse.pathExists(path.join(workspaceRoot, 'source.txt'))).toBe(true);
    expect(await fse.pathExists(path.join(workspaceRoot, 'renamed.txt'))).toBe(false);
  });

  it('guards an existing rename_path destination after the source is read', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'source.txt'), 'source');
    await fse.writeFile(path.join(workspaceRoot, 'destination.txt'), 'destination');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'source.txt',
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'rename_path',
      from: 'source.txt',
      to: 'destination.txt',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('destination.txt has not been read in this session'),
    });
    expect(await fse.readFile(path.join(workspaceRoot, 'source.txt'), 'utf8')).toBe('source');
    expect(await fse.readFile(path.join(workspaceRoot, 'destination.txt'), 'utf8')).toBe('destination');
  });

  it('allows copy_path to create a new destination without reading the source', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'source.txt'), 'source');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'copy_path',
      from: 'source.txt',
      to: 'copy.txt',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(path.join(workspaceRoot, 'copy.txt'), 'utf8')).toBe('source');
  });

  it('guards an existing copy_path destination without requiring a source read', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'source.txt'), 'source');
    await fse.writeFile(path.join(workspaceRoot, 'destination.txt'), 'destination');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'copy_path',
      from: 'source.txt',
      to: 'destination.txt',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('destination.txt has not been read in this session'),
    });
    expect(await fse.readFile(path.join(workspaceRoot, 'destination.txt'), 'utf8')).toBe('destination');
  });

  it('keeps directory deletion on its existing confirmation contract', async () => {
    const directory = path.join(workspaceRoot, 'generated');
    await fse.ensureDir(directory);
    await fse.writeFile(path.join(directory, 'artifact.txt'), 'artifact');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'delete_path',
      path: 'generated',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.pathExists(directory)).toBe(false);
  });

  it('rejects a preview whose captured original changed before acceptance', async () => {
    const target = path.join(workspaceRoot, 'preview.txt');
    await fse.writeFile(target, 'original');
    const files = new FileActionManager(workspaceRoot);
    const executor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: { features: { readBeforeWrite: true } },
        options: {},
      } as AgentRuntime,
      files,
      resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
      readStateStore: {
        getCurrentSession: () => sessionManager.getCurrentSession(),
      },
    });
    await executor.executeForTool({
      type: 'read_file',
      path: 'preview.txt',
    }, { approvalHandled: true });
    files.enterPreviewMode('preview-batch');
    const proposed = await executor.executeForTool({
      type: 'write_file',
      path: 'preview.txt',
      contents: 'proposed',
    }, { approvalHandled: true });
    expect(proposed).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('original');

    await fse.writeFile(target, 'newer external content');
    const result = await files.applyPendingChanges();

    expect(result.applied).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: expect.stringContaining('changed after preview') }),
    ]);
    expect(await fse.readFile(target, 'utf8')).toBe('newer external content');
  });

  it('keeps legacy preview acceptance unchanged when enforcement is disabled', async () => {
    const target = path.join(workspaceRoot, 'legacy-preview.txt');
    await fse.writeFile(target, 'original');
    const files = new FileActionManager(workspaceRoot);
    const executor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: { features: {} },
        options: {},
      } as AgentRuntime,
      files,
      resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
      readStateStore: {
        getCurrentSession: () => sessionManager.getCurrentSession(),
      },
    });
    files.enterPreviewMode('legacy-preview-batch');
    const proposed = await executor.executeForTool({
      type: 'write_file',
      path: 'legacy-preview.txt',
      contents: 'proposed',
    }, { approvalHandled: true });
    expect(proposed).toMatchObject({ success: true });

    await fse.writeFile(target, 'newer external content');
    const result = await files.applyPendingChanges();

    expect(result.errors).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect(await fse.readFile(target, 'utf8')).toBe('proposed');
  });

  it('does not enforce writes in ledger-only or dedup-only modes', async () => {
    const ledgerTarget = path.join(workspaceRoot, 'ledger-only.txt');
    const dedupTarget = path.join(workspaceRoot, 'dedup-only.txt');
    await fse.writeFile(ledgerTarget, 'before');
    await fse.writeFile(dedupTarget, 'before');

    const ledgerOutcome = await createExecutor({ readStateLedger: true }).executeForTool({
      type: 'write_file',
      path: 'ledger-only.txt',
      contents: 'after',
    }, { approvalHandled: true });
    const dedupOutcome = await createExecutor({ readStateDedup: true }).executeForTool({
      type: 'write_file',
      path: 'dedup-only.txt',
      contents: 'after',
    }, { approvalHandled: true });

    expect(ledgerOutcome).toMatchObject({ success: true });
    expect(dedupOutcome).toMatchObject({ success: true });
    expect(await fse.readFile(ledgerTarget, 'utf8')).toBe('after');
    expect(await fse.readFile(dedupTarget, 'utf8')).toBe('after');
  });

  it('lets the emergency switch bypass enforcement for compatibility', async () => {
    process.env.AUTOHAND_DISABLE_STATEFUL_READ = '1';
    const target = path.join(workspaceRoot, 'escape-write.txt');
    await fse.writeFile(target, 'before');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'escape-write.txt',
      contents: 'after',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('after');
  });

  it('does not let unrestricted mode bypass read-before-write safety', async () => {
    const target = path.join(workspaceRoot, 'unrestricted.txt');
    await fse.writeFile(target, 'before');
    const executor = createExecutor({ readBeforeWrite: true }, { unrestricted: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'unrestricted.txt',
      contents: 'after',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('has not been read'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('before');
  });

  it('uses a complete ledger after resuming the same session', async () => {
    const target = path.join(workspaceRoot, 'resume-write.txt');
    await fse.writeFile(target, 'before');
    const sessionId = sessionManager.getCurrentSession()!.metadata.sessionId;
    await createExecutor({ readBeforeWrite: true }).executeForTool({
      type: 'read_file',
      path: 'resume-write.txt',
    }, { approvalHandled: true });

    const resumedManager = new SessionManager(sessionsRoot);
    await resumedManager.initialize();
    await resumedManager.loadSession(sessionId);
    sessionManager = resumedManager;
    const outcome = await createExecutor({ readBeforeWrite: true }).executeForTool({
      type: 'write_file',
      path: 'resume-write.txt',
      contents: 'after',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('after');
  });

  it('does not carry ledger authorization into a new session', async () => {
    const target = path.join(workspaceRoot, 'new-session.txt');
    await fse.writeFile(target, 'before');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'new-session.txt',
    }, { approvalHandled: true });
    await sessionManager.createSession(workspaceRoot, 'test-model');

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'new-session.txt',
      contents: 'after',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('has not been read'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('before');
  });

  it('starts cloned and forked sessions with empty read authorization', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'branched.txt'), 'before');
    const sourceSession = sessionManager.getCurrentSession()!;
    await sourceSession.append({
      role: 'user',
      content: 'Inspect branched.txt',
      timestamp: new Date().toISOString(),
    });
    const sourceSessionId = sourceSession.metadata.sessionId;
    await createExecutor({ readBeforeWrite: true }).executeForTool({
      type: 'read_file',
      path: 'branched.txt',
    }, { approvalHandled: true });

    const cloned = await sessionManager.branchSession(sourceSessionId, { type: 'clone' });
    const forked = await sessionManager.branchSession(sourceSessionId, {
      type: 'fork',
      userMessageOrdinal: 1,
    });

    expect(cloned.getReadFileState()).toBeNull();
    expect(forked.getReadFileState()).toBeNull();
    const outcome = await createExecutor({ readBeforeWrite: true }).executeForTool({
      type: 'write_file',
      path: 'branched.txt',
      contents: 'after',
    }, { approvalHandled: true });
    expect(outcome).toMatchObject({
      success: false,
      error: expect.stringContaining('has not been read'),
    });
  });

  it('authorizes a large file only after contiguous paginated coverage is complete', async () => {
    const target = path.join(workspaceRoot, 'paginated-write.txt');
    await fse.writeFile(target, 'one\ntwo\nthree\nfour');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'paginated-write.txt',
      limit: 2,
    }, { approvalHandled: true });
    const partialWrite = await executor.executeForTool({
      type: 'write_file',
      path: 'paginated-write.txt',
      contents: 'too soon',
    }, { approvalHandled: true });
    expect(partialWrite).toMatchObject({
      success: false,
      error: expect.stringContaining('Only part'),
    });
    await executor.executeForTool({
      type: 'read_file',
      path: 'paginated-write.txt',
      offset: 2,
      limit: 2,
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'paginated-write.txt',
      contents: 'complete now',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('complete now');
  });

  it('treats an offset-zero empty-file read as complete', async () => {
    const target = path.join(workspaceRoot, 'empty-write.txt');
    await fse.writeFile(target, '');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'empty-write.txt',
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'empty-write.txt',
      contents: 'now populated',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('now populated');
  });

  it('does not revoke empty-file authorization after a beyond-EOF probe', async () => {
    const target = path.join(workspaceRoot, 'empty-probe.txt');
    await fse.writeFile(target, '');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'empty-probe.txt',
    }, { approvalHandled: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'empty-probe.txt',
      offset: 1,
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'empty-probe.txt',
      contents: 'now populated',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(await fse.readFile(target, 'utf8')).toBe('now populated');
  });

  it('requires a fresh read before a second mutation of the same file', async () => {
    const target = path.join(workspaceRoot, 'twice.txt');
    await fse.writeFile(target, 'first');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({ type: 'read_file', path: 'twice.txt' }, { approvalHandled: true });
    await executor.executeForTool({
      type: 'write_file',
      path: 'twice.txt',
      contents: 'second',
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'twice.txt',
      contents: 'third',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('changed after it was read'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('second');
  });

  it('returns an identical-content no-op without requiring a read', async () => {
    const target = path.join(workspaceRoot, 'no-op.txt');
    await fse.writeFile(target, 'same');
    const executor = createExecutor({ readBeforeWrite: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'no-op.txt',
      contents: 'same',
    }, { approvalHandled: true });

    expect(outcome).toEqual({
      success: true,
      output: 'No changes needed for no-op.txt (content identical)',
    });
  });

  it('merges byte-ceiling continuation windows without counting the cut line twice', async () => {
    const target = path.join(workspaceRoot, 'byte-paginated.txt');
    const wideLine = '😀'.repeat(1_000);
    await fse.writeFile(target, Array.from({ length: 100 }, () => wideLine).join('\n'));
    const executor = createExecutor({ readBeforeWrite: true });
    let offset = 0;
    for (let readCount = 0; readCount < 10; readCount++) {
      const outcome = await executor.executeForTool({
        type: 'read_file',
        path: 'byte-paginated.txt',
        offset,
      }, { approvalHandled: true });
      expect(outcome).toMatchObject({ success: true });
      const nextOffset = outcome.success
        ? outcome.output?.match(/offset=(\d+) limit=2000/u)?.[1]
        : undefined;
      if (nextOffset === undefined) {
        break;
      }
      offset = Number(nextOffset);
    }

    expect(sessionManager.getCurrentSession()?.getReadFileState()?.entries[0]).toMatchObject({
      coverage: [{ startLine: 0, endLineExclusive: 100 }],
      totalLines: 100,
      complete: true,
    });
    const write = await executor.executeForTool({
      type: 'rename_path',
      from: 'byte-paginated.txt',
      to: 'byte-paginated-renamed.txt',
    }, { approvalHandled: true });
    expect(write).toMatchObject({ success: true });
    expect(await fse.pathExists(path.join(workspaceRoot, 'byte-paginated-renamed.txt'))).toBe(true);
  });

  it('does not authorize a scan with a missing source-line gap', async () => {
    const target = path.join(workspaceRoot, 'gap.txt');
    await fse.writeFile(target, 'zero\none\ntwo');
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'gap.txt',
      limit: 1,
    }, { approvalHandled: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'gap.txt',
      offset: 2,
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'gap.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('Only part'),
    });
    expect(await fse.readFile(target, 'utf8')).toBe('zero\none\ntwo');
  });

  it('does not authorize a full scan containing a clamped line', async () => {
    const target = path.join(workspaceRoot, 'clamped-write.txt');
    await fse.writeFile(target, `${'x'.repeat(2_001)}\ntail`);
    const executor = createExecutor({ readBeforeWrite: true });
    await executor.executeForTool({
      type: 'read_file',
      path: 'clamped-write.txt',
    }, { approvalHandled: true });

    const outcome = await executor.executeForTool({
      type: 'write_file',
      path: 'clamped-write.txt',
      contents: 'replacement',
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'authorization',
      error: expect.stringContaining('Only part'),
    });
    expect(await fse.readFile(target, 'utf8')).toContain('x'.repeat(2_001));
  });

  it('fails soft and replaces malformed persisted read state on resume', async () => {
    const session = sessionManager.getCurrentSession()!;
    const sessionId = session.metadata.sessionId;
    session.metadata.readFileState = {
      schemaVersion: 1,
      entries: [null],
    } as unknown as NonNullable<typeof session.metadata.readFileState>;
    await session.save();
    await fse.writeFile(path.join(workspaceRoot, 'recover-state.txt'), 'recovered');

    const resumedManager = new SessionManager(sessionsRoot);
    await resumedManager.initialize();
    await resumedManager.loadSession(sessionId);
    sessionManager = resumedManager;
    const outcome = await createExecutor({ readStateLedger: true }).executeForTool({
      type: 'read_file',
      path: 'recover-state.txt',
    }, { approvalHandled: true });

    expect(outcome).toEqual({ success: true, output: '     1\trecovered' });
    expect(sessionManager.getCurrentSession()?.getReadFileState()?.entries).toEqual([
      expect.objectContaining({ complete: true }),
    ]);
  });
});

describe('ReadSessionLedger bounds', () => {
  function createLedger(): {
    ledger: ReadSessionLedger;
    getState: () => SessionReadFileState | null;
  } {
    let state: SessionReadFileState | null = null;
    return {
      ledger: new ReadSessionLedger({
        getCurrentSession: () => ({
          metadata: { sessionId: 'bounded-session' },
          getReadFileState: () => state,
          updateReadFileState: async (nextState) => {
            state = structuredClone(nextState);
          },
        }),
      }),
      getState: () => state,
    };
  }

  it('evicts the least-recent file after 128 entries', async () => {
    const { ledger, getState } = createLedger();
    for (let index = 0; index < 129; index++) {
      await ledger.recordRead({
        path: `/workspace/${index}.txt`,
        revision: { sizeBytes: 1, mtimeMs: 1, ctimeMs: 1 },
        revisionStable: true,
        visibleLines: [0],
        reachedEof: true,
        totalLines: 1,
        sha256: 'a'.repeat(64),
        offset: 0,
      });
    }

    expect(getState()?.entries).toHaveLength(128);
    expect(getState()?.entries[0].path).toBe('/workspace/128.txt');
    expect(getState()?.entries.some(entry => entry.path === '/workspace/0.txt')).toBe(false);
  });

  it('keeps only the 16 most recent dedup views per file', async () => {
    const { ledger, getState } = createLedger();
    for (let index = 0; index < 17; index++) {
      await ledger.recordRead({
        path: '/workspace/bounded.txt',
        revision: { sizeBytes: 1, mtimeMs: 1, ctimeMs: 1 },
        revisionStable: true,
        visibleLines: [0],
        reachedEof: true,
        totalLines: 1,
        sha256: 'a'.repeat(64),
        offset: 0,
        viewKey: `view-${index}`,
      });
    }

    expect(getState()?.entries[0].views).toHaveLength(16);
    expect(getState()?.entries[0].views[0].key).toBe('view-16');
    expect(getState()?.entries[0].views.some(view => view.key === 'view-0')).toBe(false);
  });

  it('bounds adversarial disjoint coverage without granting completeness', async () => {
    const { ledger, getState } = createLedger();
    await ledger.recordRead({
      path: '/workspace/disjoint.txt',
      revision: { sizeBytes: 600, mtimeMs: 1, ctimeMs: 1 },
      revisionStable: true,
      visibleLines: Array.from({ length: 600 }, (_, index) => index)
        .filter(index => index % 2 === 0),
      reachedEof: true,
      totalLines: 600,
      sha256: 'a'.repeat(64),
      offset: 0,
    });

    expect(getState()?.entries[0].coverage).toHaveLength(256);
    expect(getState()?.entries[0].complete).toBe(false);
  });
});
