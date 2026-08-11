/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_LIMITS, FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentAction, AgentRuntime, ToolActionOutcome } from '../src/types.js';

describe('read_file public contract', () => {
  let workspaceRoot: string;
  let executor: ActionExecutor;

  beforeEach(async () => {
    workspaceRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-read-tool-'));
    executor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: {},
        options: {},
      } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
    });
  });

  afterEach(async () => {
    await fse.remove(workspaceRoot);
  });

  async function executeRead(action: Extract<AgentAction, { type: 'read_file' }>): Promise<ToolActionOutcome> {
    return executor.executeForTool(action, { approvalHandled: true });
  }

  it('returns small text with stable one-based source line numbers', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'example.txt'), 'alpha\nbeta');

    const outcome = await executeRead({ type: 'read_file', path: 'example.txt' });

    expect(outcome).toEqual({
      success: true,
      output: '     1\talpha\n     2\tbeta',
    });
  });

  it('captures a full-file digest only when stateful reads request it', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'digest.txt'), 'digest me');
    const files = new FileActionManager(workspaceRoot);
    const options = {
      offset: 0,
      lineLimit: 2_000,
      maxBytes: 128 * 1024,
      maxLineCharacters: 2_000,
    };

    const legacy = await files.readFileWindow('digest.txt', options);
    const stateful = await files.readFileWindow('digest.txt', {
      ...options,
      captureDigest: true,
    });

    expect(legacy.sha256).toBeUndefined();
    expect(stateful.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('describes an empty file instead of returning silence', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'empty.txt'), '');

    const outcome = await executeRead({ type: 'read_file', path: 'empty.txt' });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: empty.txt is empty.',
    });
  });

  it('describes an explicit nonzero offset on an empty file as beyond EOF', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'empty.txt'), '');

    const outcome = await executeRead({ type: 'read_file', path: 'empty.txt', offset: 1 });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: offset 1 is beyond the end of empty.txt (0 lines scanned). Retry with a smaller offset.',
    });
  });

  it('describes an offset beyond EOF and recommends a smaller offset', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'short.txt'), 'alpha\nbeta');

    const outcome = await executeRead({ type: 'read_file', path: 'short.txt', offset: 3 });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: offset 3 is beyond the end of short.txt (2 lines scanned). Retry with a smaller offset.',
    });
  });

  it('enforces the line ceiling and returns an exact continuation offset', async () => {
    const contents = Array.from({ length: 2_001 }, (_, index) => `line-${index + 1}`).join('\n');
    await fse.writeFile(path.join(workspaceRoot, 'long.txt'), contents);

    const outcome = await executeRead({ type: 'read_file', path: 'long.txt', limit: 5_000 });

    expect(outcome).toMatchObject({ success: true });
    expect(outcome.output).toContain('  2000\tline-2000');
    expect(outcome.output).not.toContain('\tline-2001');
    expect(outcome.output).toContain('offset=2000 limit=2000');
  });

  it('does not emit a continuation note at the exact line boundary', async () => {
    const contents = Array.from({ length: 2_000 }, (_, index) => `line-${index + 1}`).join('\n');
    await fse.writeFile(path.join(workspaceRoot, 'exact.txt'), contents);

    const outcome = await executeRead({ type: 'read_file', path: 'exact.txt' });

    expect(outcome).toMatchObject({ success: true });
    expect(outcome.output).toContain('  2000\tline-2000');
    expect(outcome.output).not.toContain('More content remains');
    expect(outcome.output).not.toContain('offset=2000');
  });

  it('clamps an oversized line and discloses the affected source line', async () => {
    await fse.writeFile(
      path.join(workspaceRoot, 'minified.js'),
      `${'x'.repeat(2_001)}\ntail`,
    );

    const outcome = await executeRead({ type: 'read_file', path: 'minified.js' });

    expect(outcome).toMatchObject({ success: true });
    const [firstLine] = outcome.output?.split('\n') ?? [];
    expect(firstLine).toBe(`     1\t${'x'.repeat(2_000)}`);
    expect(outcome.output).toContain('Line 1 exceeded 2000 characters and was clamped.');
    expect(outcome.output).toContain('fff_grep or shell');
  });

  it('strips a UTF-8 BOM and normalizes CRLF before returning text', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'windows.txt'), '\uFEFFalpha\r\nbeta\r\n');

    const outcome = await executeRead({ type: 'read_file', path: 'windows.txt' });

    expect(outcome).toEqual({
      success: true,
      output: '     1\talpha\n     2\tbeta',
    });
  });

  it('enforces the byte ceiling without splitting UTF-8 and resumes on the cut line', async () => {
    const wideLine = '😀'.repeat(1_000);
    await fse.writeFile(
      path.join(workspaceRoot, 'unicode.log'),
      Array.from({ length: 100 }, () => wideLine).join('\n'),
    );

    const first = await executeRead({ type: 'read_file', path: 'unicode.log' });

    expect(first).toMatchObject({ success: true });
    expect(Buffer.byteLength(first.output ?? '', 'utf8')).toBeLessThanOrEqual(128 * 1024);
    expect(first.output).not.toContain('�');
    expect(first.output).toContain('128 KiB read ceiling');
    const resumeMatch = first.output?.match(/offset=(\d+) limit=2000/);
    expect(resumeMatch).not.toBeNull();
    const resumeOffset = Number(resumeMatch?.[1]);
    const returnedLineNumbers = (first.output?.match(/^\s*(\d+)\t/gm) ?? [])
      .map(line => Number(line.trim().split('\t')[0]));
    expect(resumeOffset).toBe(returnedLineNumbers.at(-1)! - 1);
    expect(resumeOffset).toBeGreaterThan(0);
    expect(resumeOffset).toBeLessThan(100);

    const second = await executeRead({
      type: 'read_file',
      path: 'unicode.log',
      offset: resumeOffset,
    });
    expect(second).toMatchObject({ success: true });
    expect(second.output).not.toContain('�');
    expect(second.output).toContain(`${String(resumeOffset + 1).padStart(6)}\t😀`);
  });

  it('streams a selected window without accumulating a huge earlier line', async () => {
    const hugeSkippedLine = Buffer.alloc(FILE_LIMITS.MAX_READ_SIZE + 1, 0x78);
    await fse.writeFile(
      path.join(workspaceRoot, 'huge.log'),
      Buffer.concat([hugeSkippedLine, Buffer.from('\ntarget')]),
    );

    const outcome = await executeRead({
      type: 'read_file',
      path: 'huge.log',
      offset: 1,
      limit: 1,
    });

    expect(outcome).toEqual({
      success: true,
      output: '     2\ttarget',
    });
  });

  it.each([
    ['negative offset', { offset: -1 }],
    ['fractional offset', { offset: 1.5 }],
    ['non-finite offset', { offset: Number.POSITIVE_INFINITY }],
    ['negative limit', { limit: -1 }],
    ['fractional limit', { limit: 1.5 }],
    ['NaN limit', { limit: Number.NaN }],
  ])('rejects %s at the direct executor boundary', async (_case, window) => {
    await fse.writeFile(path.join(workspaceRoot, 'validation.txt'), 'content');

    const outcome = await executor.executeForTool({
      type: 'read_file',
      path: 'validation.txt',
      ...window,
    } as AgentAction, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'validation',
      error: expect.stringContaining('non-negative integer'),
    });
  });

  it('detects binary images from magic bytes instead of the filename extension', async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]);
    await fse.writeFile(path.join(workspaceRoot, 'misnamed.txt'), pngHeader);

    const outcome = await executeRead({ type: 'read_file', path: 'misnamed.txt' });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: misnamed.txt is a binary image/png file. read_file did not decode it as text.',
    });
    expect(outcome.output).not.toContain('\u0000');
  });

  it('returns an actionable extraction hint for PDFs', async () => {
    await fse.writeFile(
      path.join(workspaceRoot, 'document.pdf'),
      Buffer.from('%PDF-1.7\n% binary payload\u0000'),
    );

    const outcome = await executeRead({ type: 'read_file', path: 'document.pdf' });

    expect(outcome).toEqual({
      success: true,
      output: 'Note: document.pdf is a binary application/pdf file. Use pdftotext "document.pdf" - to extract its text.',
    });
  });

  it('keeps SVG XML on the numbered text path', async () => {
    await fse.writeFile(
      path.join(workspaceRoot, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg">\n<path d="M0 0"/>\n</svg>',
    );

    const outcome = await executeRead({ type: 'read_file', path: 'icon.svg' });

    expect(outcome).toEqual({
      success: true,
      output: [
        '     1\t<svg xmlns="http://www.w3.org/2000/svg">',
        '     2\t<path d="M0 0"/>',
        '     3\t</svg>',
      ].join('\n'),
    });
  });

  it('repairs an invisible narrow-space filename mismatch and discloses the opened path', async () => {
    const actualName = 'Screenshot 3.04\u202FPM.txt';
    const requestedName = 'Screenshot 3.04 PM.txt';
    await fse.writeFile(path.join(workspaceRoot, actualName), 'pixels');

    const outcome = await executeRead({ type: 'read_file', path: requestedName });

    expect(outcome).toEqual({
      success: true,
      output: `Note: Opened "${actualName}" after repairing requested path "${requestedName}".\n\n     1\tpixels`,
    });
  });

  it('repairs a filename containing more than one punctuation mismatch', async () => {
    const actualName = 'Team\u2019s 3\u202FPM.txt';
    const requestedName = "Team's 3 PM.txt";
    await fse.writeFile(path.join(workspaceRoot, actualName), 'schedule');

    const outcome = await executeRead({ type: 'read_file', path: requestedName });

    expect(outcome).toEqual({
      success: true,
      output: `Note: Opened "${actualName}" after repairing requested path "${requestedName}".\n\n     1\tschedule`,
    });
  });

  it('records a repaired read against the actual opened path exactly once', async () => {
    const actualName = 'Screenshot 3.04\u202FPM.txt';
    const requestedName = 'Screenshot 3.04 PM.txt';
    const recordRead = vi.fn();
    const onExploration = vi.fn();
    await fse.writeFile(path.join(workspaceRoot, actualName), 'pixels');
    const observableExecutor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: {},
        options: {},
      } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: async () => true,
      onExploration,
      peerAwareness: {
        warnForWrite: vi.fn(() => []),
        warnForCommand: vi.fn(() => []),
        adoptRepoBaseline: vi.fn(async () => {}),
        recordRead,
        recordWrite: vi.fn(),
      },
    });

    const outcome = await observableExecutor.executeForTool({
      type: 'read_file',
      path: requestedName,
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({ success: true });
    expect(recordRead).toHaveBeenCalledOnce();
    expect(recordRead).toHaveBeenCalledWith(actualName, expect.any(Number));
    expect(onExploration).toHaveBeenCalledOnce();
    expect(onExploration).toHaveBeenCalledWith({ kind: 'read', target: actualName });
  });

  it('reports an absolute repaired request using the opened workspace-relative path', async () => {
    const actualName = 'Screenshot 3.04\u202FPM.txt';
    const requestedPath = path.join(workspaceRoot, 'Screenshot 3.04 PM.txt');
    await fse.writeFile(path.join(workspaceRoot, actualName), 'pixels');

    const outcome = await executeRead({ type: 'read_file', path: requestedPath });

    expect(outcome).toEqual({
      success: true,
      output: `Note: Opened "${actualName}" after repairing requested path "${requestedPath}".\n\n     1\tpixels`,
    });
  });

  it('rejects a Unicode-repaired symlink that resolves outside the workspace', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const outsideRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-read-tool-outside-'));
    const outsidePath = path.join(outsideRoot, 'secret.txt');
    const repairedName = 'secret\u202Ffile.txt';
    await fse.writeFile(outsidePath, 'do not disclose');
    await fse.symlink(outsidePath, path.join(workspaceRoot, repairedName));

    try {
      const outcome = await executeRead({ type: 'read_file', path: 'secret file.txt' });

      expect(outcome).toMatchObject({ success: false, kind: 'operational' });
      expect(outcome.output ?? '').not.toContain('do not disclose');
    } finally {
      await fse.remove(outsideRoot);
    }
  });

  it('suggests a bounded edit-distance filename when recovery cannot open a match', async () => {
    await fse.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Instructions');

    const outcome = await executeRead({ type: 'read_file', path: 'AGENT.md' });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'operational',
      error: expect.stringContaining('Did you mean "AGENTS.md"?'),
    });
  });

  it('returns at most three deterministic sibling suggestions', async () => {
    await Promise.all([
      'AGENTA.md',
      'AGENTB.md',
      'AGENTC.md',
      'AGENTD.md',
    ].map(fileName => fse.writeFile(path.join(workspaceRoot, fileName), fileName)));

    const outcome = await executeRead({ type: 'read_file', path: 'AGENT.md' });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'operational',
      error: 'File AGENT.md not found in workspace. Did you mean one of: "AGENTA.md", "AGENTB.md", "AGENTC.md"?',
    });
  });

  it.each([
    '/dev/zero',
    '/dev/random',
    '/dev/urandom',
    '/dev/stdin',
    '/dev/fd/0',
    '/proc/self/fd/0',
    '/proc/thread-self/fd/0',
    '/proc/1/fd/0',
  ])('refuses pseudo-device stream %s by name before opening it', async (devicePath) => {
    if (process.platform === 'win32') {
      return;
    }
    const filesystemRoot = path.parse(process.cwd()).root;
    const rootExecutor = new ActionExecutor({
      runtime: {
        workspaceRoot: filesystemRoot,
        config: {},
        options: {},
      } as AgentRuntime,
      files: new FileActionManager(filesystemRoot),
      resolveWorkspacePath: requestedPath => path.resolve(filesystemRoot, requestedPath),
      confirmDangerousAction: async () => true,
    });

    const outcome = await rootExecutor.executeForTool({
      type: 'read_file',
      path: devicePath,
    }, { approvalHandled: true });

    expect(outcome).toMatchObject({
      success: false,
      kind: 'operational',
      error: expect.stringContaining('refuses device or stream path'),
    });
  });
});
