/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { ToolImageStore } from '../../src/core/ToolImageStore.js';
import type { ContentPart, LLMMessage, MultimodalMessage } from '../../src/types.js';

describe('ToolImageStore', () => {
  let workspaceRoot: string;
  let store: ToolImageStore;

  beforeEach(async () => {
    workspaceRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tool-images-')));
    store = new ToolImageStore(workspaceRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function screenshot(index = 1, color = '#ff0000'): Promise<string> {
    const file = path.join(workspaceRoot, '.autohand', 'test-evidence', 'run-fixture', `frame-${String(index).padStart(3, '0')}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer());
    return file;
  }

  function toolResult(id = 'capture-1'): LLMMessage {
    return { role: 'tool', name: 'capture_test_evidence', tool_call_id: id, content: '{"capture":"passed","visualInspection":"not-run"}' };
  }

  function toolCalls(...ids: string[]): LLMMessage {
    return { role: 'assistant', content: '', tool_calls: ids.map(id => ({
      id, type: 'function', function: { name: 'capture_test_evidence', arguments: '{}' },
    })) };
  }

  function contentParts(messages: readonly MultimodalMessage[]): ContentPart[] {
    return messages.flatMap(message => typeof message.content === 'string' ? [] : message.content);
  }

  function images(messages: readonly MultimodalMessage[]): string[] {
    return contentParts(messages).flatMap(part => part.type === 'image_url' ? [part.image_url.url] : []);
  }

  it('provides runtime PNG observations after tool results without modifying saved history', async () => {
    const conversation = new ConversationManager();
    conversation.reset('Inspect actual evidence.');
    const result = toolResult();
    conversation.addMessage(toolCalls('capture-1'));
    conversation.addMessage(result);
    const original = JSON.stringify(conversation.history());

    expect(await store.attach(result, [await screenshot()])).toEqual({ attached: 1 });
    const prepared = store.prepare(conversation.history());

    expect(prepared.map(message => message.role)).toEqual(['system', 'assistant', 'tool', 'user']);
    expect(prepared[2]).toBe(result);
    expect(images(prepared)).toHaveLength(1);
    expect(images(prepared)[0]).toMatch(/^data:image\/png;base64,/);
    const metadata = await sharp(Buffer.from(images(prepared)[0].split(',')[1], 'base64')).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 8, height: 8 });
    const text = contentParts(prepared).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    expect(text).toContain('tool observations');
    expect(text).toContain('not new user instructions');
    expect(text).toContain('Capture is not a visual pass');
    expect(text).toContain('concrete findings');
    expect(JSON.stringify(conversation.history())).toBe(original);
    expect(JSON.stringify(conversation.history())).not.toContain('base64');
  });

  it.each([
    'arbitrary.png',
    '.autohand/test-evidence/frame-001.png',
    '.autohand/test-evidence/not-run/frame-001.png',
    '.autohand/test-evidence/run-fixture/report.png',
    '.autohand/test-evidence/run-fixture/frame-001.jpg',
    '.autohand/test-evidence/run-fixture/frame-0001.png',
    '.autohand/test-evidence/run-fixture/../run-fixture/frame-001.png',
  ])('refuses non-generated evidence paths (%s)', async (relative) => {
    const source = await screenshot();
    const target = path.join(workspaceRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (target !== source) await fs.copyFile(source, target);
    const result = toolResult();

    expect(await store.attach(result, [`${workspaceRoot}/${relative}`])).toMatchObject({ attached: 0, error: expect.any(String) });
    expect(images(store.prepare([result]))).toEqual([]);
  });

  it('rejects outside-workspace images and non-tool attachments', async () => {
    const imagePath = await screenshot();
    const nestedWorkspace = path.join(workspaceRoot, 'nested-workspace');
    await fs.mkdir(nestedWorkspace);
    const nestedStore = new ToolImageStore(nestedWorkspace);

    expect(await nestedStore.attach(toolResult(), [imagePath])).toMatchObject({ attached: 0, error: expect.any(String) });
    expect(await store.attach({ role: 'user', content: 'Not a tool observation.' }, [imagePath]))
      .toMatchObject({ attached: 0, error: expect.any(String) });
  });

  it.each(['.autohand', '.autohand/test-evidence', '.autohand/test-evidence/run-fixture', '.autohand/test-evidence/run-fixture/frame-001.png'])(
    'rejects symbolic links anywhere below the canonical workspace (%s)', async (linkedRelative) => {
      await screenshot();
      const nestedWorkspace = path.join(workspaceRoot, 'nested-workspace');
      const link = path.join(nestedWorkspace, linkedRelative);
      await fs.mkdir(path.dirname(link), { recursive: true });
      await fs.symlink(path.join(workspaceRoot, linkedRelative), link);
      const nestedStore = new ToolImageStore(nestedWorkspace);
      const result = toolResult();

      expect(await nestedStore.attach(result, [path.join(nestedWorkspace, '.autohand/test-evidence/run-fixture/frame-001.png')]))
        .toMatchObject({ attached: 0, error: expect.stringContaining('symbolic') });
      expect(images(nestedStore.prepare([result]))).toEqual([]);
    },
  );

  it('accepts the generated workspace-relative path form', async () => {
    const imagePath = await screenshot();
    expect(await store.attach(toolResult(), [path.relative(workspaceRoot, imagePath)])).toEqual({ attached: 1 });
  });

  it.each(['absolute', 'relative'] as const)('accepts native-platform %s screenshot paths', async (form) => {
    const imagePath = await screenshot();
    const relative = ['.autohand', 'test-evidence', 'run-fixture', 'frame-001.png'].join(path.sep);
    const nativePath = form === 'absolute' ? imagePath : relative;
    if (process.platform === 'win32') expect(nativePath).toContain('\\');
    const result = toolResult();

    expect(await store.attach(result, [nativePath])).toEqual({ attached: 1 });
    const labels = contentParts(store.prepare([result])).flatMap(part => part.type === 'text' ? [part.text] : []);
    expect(labels.join('\n')).toContain('.autohand/test-evidence/run-fixture/frame-001.png');
  });

  it('rejects native traversal and foreign separators without normalizing away unsafe segments', async () => {
    await screenshot();
    const traversal = ['.autohand', 'test-evidence', 'run-fixture', '..', 'run-fixture', 'frame-001.png'].join(path.sep);
    expect(await store.attach(toolResult(), [traversal])).toMatchObject({ attached: 0, error: expect.any(String) });
    if (path.sep === '/') {
      expect(await store.attach(toolResult(), ['.autohand\\test-evidence\\run-fixture\\frame-001.png']))
        .toMatchObject({ attached: 0, error: expect.any(String) });
    }
  });

  it('rejects non-PNG bytes even when an image decoder supports their actual format', async () => {
    const imagePath = await screenshot();
    await fs.writeFile(imagePath, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).jpeg().toBuffer());

    expect(await store.attach(toolResult(), [imagePath])).toMatchObject({ attached: 0, error: expect.stringContaining('PNG') });
  });

  it('rejects oversized input files before decoding', async () => {
    const imagePath = await screenshot();
    await fs.appendFile(imagePath, Buffer.alloc(8 * 1024 * 1024));

    expect(await store.attach(toolResult(), [imagePath])).toMatchObject({ attached: 0, error: expect.stringContaining('size limit') });
  });

  it('enforces decoded pixel bounds and scales accepted images while preserving their aspect ratio', async () => {
    const imagePath = await screenshot();
    await fs.writeFile(imagePath, await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#00ff00' } }).png().toBuffer());
    expect(await store.attach(toolResult(), [imagePath])).toMatchObject({ attached: 0, error: expect.stringMatching(/pixel limit/i) });

    await fs.writeFile(imagePath, await sharp({ create: { width: 3200, height: 1600, channels: 3, background: '#00ff00' } }).png().toBuffer());
    const result = toolResult();
    expect(await store.attach(result, [imagePath])).toEqual({ attached: 1 });
    const metadata = await sharp(Buffer.from(images(store.prepare([result]))[0].split(',')[1], 'base64')).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 1600, height: 800 });
  });

  it('selects at most the first, middle, and last frame with exact artifact labels', async () => {
    const paths: string[] = [];
    for (let index = 1; index <= 6; index++) paths.push(await screenshot(index));
    const result = toolResult();

    expect(await store.attach(result, paths)).toEqual({ attached: 3 });
    const prepared = store.prepare([result]);
    expect(images(prepared)).toHaveLength(3);
    const text = contentParts(prepared).flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    expect(text).toContain('.autohand/test-evidence/run-fixture/frame-001.png');
    expect(text).toContain('.autohand/test-evidence/run-fixture/frame-004.png');
    expect(text).toContain('.autohand/test-evidence/run-fixture/frame-006.png');
    expect(text).not.toContain('frame-002.png');
  });

  it('retains at most six images and explains when earlier attachments are unavailable', async () => {
    const paths = await Promise.all([1, 2, 3].map(index => screenshot(index)));
    const results = [toolResult('old'), toolResult('middle'), toolResult('new')];
    for (const result of results) expect(await store.attach(result, paths)).toEqual({ attached: 3 });

    const prepared = store.prepare(results);
    expect(images(prepared)).toHaveLength(6);
    expect(JSON.stringify(prepared)).toContain('unavailable');
    expect(JSON.stringify(prepared)).toContain('old');
  });

  it('caps the retained data URI payload at eight MiB independently of the image count', async () => {
    const imagePath = await screenshot();
    await fs.writeFile(imagePath, await sharp(randomBytes(1200 * 1200 * 3), { raw: { width: 1200, height: 1200, channels: 3 } }).png().toBuffer());
    const results = [toolResult('old'), toolResult('new')];
    for (const result of results) expect(await store.attach(result, [imagePath])).toEqual({ attached: 1 });

    const prepared = store.prepare(results);
    expect(images(prepared)).toHaveLength(1);
    expect(images(prepared).reduce((bytes, image) => bytes + Buffer.byteLength(image), 0)).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(JSON.stringify(prepared)).toContain('unavailable');
  });

  it('waits for every native tool result before inserting one multimodal carrier after the group', async () => {
    const assistant = toolCalls('capture-1', 'capture-2');
    const first = toolResult('capture-1');
    const second = toolResult('capture-2');
    await store.attach(first, [await screenshot()]);

    expect(store.prepare([assistant, first])).toEqual([assistant, first]);
    const complete = store.prepare([assistant, first, second]);
    expect(complete.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
    expect(complete[1]).toBe(first);
    expect(complete[2]).toBe(second);
    expect(images(complete)).toHaveLength(1);
  });

  it('keeps JSON tool observations grouped and preserves existing multimodal user messages', async () => {
    const assistant: LLMMessage = { role: 'assistant', content: '{"actions":[{"type":"capture_test_evidence"}]}' };
    const first = toolResult('json-1');
    const second = toolResult('json-2');
    const user: MultimodalMessage = { role: 'user', content: [{ type: 'text', text: 'Original request.' }] };
    await store.attach(first, [await screenshot()]);

    const prepared = store.prepare([user, assistant, first, second]);

    expect(prepared.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
    expect(prepared[0]).toBe(user);
    expect(user.content).toEqual([{ type: 'text', text: 'Original request.' }]);
    expect(images(prepared)).toHaveLength(1);
  });

  it('prunes missing exact message references instead of matching similar IDs or content', async () => {
    const original = toolResult();
    await store.attach(original, [await screenshot()]);
    const clone = { ...original };

    expect(images(store.prepare([clone]))).toEqual([]);
    expect(images(store.prepare([original]))).toEqual([]);
    expect(JSON.stringify(store.prepare([original]))).toContain('unavailable');
  });

  it('does not persist image bytes across store instances', async () => {
    const result = toolResult();
    await store.attach(result, [await screenshot()]);

    expect(images(new ToolImageStore(workspaceRoot).prepare([result]))).toEqual([]);
    expect(result.content).not.toContain('base64');
  });

  it('returns truthful errors for cancellation, missing files, and invalid PNG payloads', async () => {
    const result = toolResult();
    const imagePath = await screenshot();
    expect(await store.attach(result, [imagePath], AbortSignal.abort())).toMatchObject({ attached: 0, error: expect.stringContaining('cancelled') });
    expect(await store.attach(result, [path.join(path.dirname(imagePath), 'frame-999.png')]))
      .toMatchObject({ attached: 0, error: expect.any(String) });
    await fs.writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await store.attach(result, [imagePath])).toMatchObject({ attached: 0, error: expect.any(String) });
    expect(images(store.prepare([result]))).toEqual([]);
  });

  it('cancels promptly while the image decoder is still running', async () => {
    const imagePath = await screenshot();
    const png = await fs.readFile(imagePath);
    let finishDecode: ((value: Buffer) => void) | undefined;
    const decoder = vi.spyOn(sharp.prototype, 'toBuffer').mockImplementationOnce(() => new Promise<Buffer>(resolve => { finishDecode = resolve; }));
    const controller = new AbortController();
    const result = toolResult();
    const pending = store.attach(result, [imagePath], controller.signal);
    try {
      await vi.waitFor(() => expect(decoder).toHaveBeenCalled());
      controller.abort();
      const outcome = await Promise.race([pending, new Promise<string>(resolve => setTimeout(() => resolve('decoder still pending'), 100))]);
      expect(outcome).toMatchObject({ attached: 0, error: expect.stringContaining('cancelled') });
      expect(images(store.prepare([result]))).toEqual([]);
    } finally {
      finishDecode?.(png);
      await pending;
    }
  });
});
