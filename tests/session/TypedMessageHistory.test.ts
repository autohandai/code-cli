/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { TypedMessageHistory } from '../../src/session/TypedMessageHistory.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function historyFile() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'typed-history-'));
  roots.push(root);
  return path.join(root, 'typed-message-history.json');
}

describe('TypedMessageHistory', () => {
  it('persists exact multiline prompts across cwd and service instances', async () => {
    const file = await historyFile();
    await new TypedMessageHistory(file).record('hello\n世界 🌍', '/project/one');
    const history = new TypedMessageHistory(file);
    await history.refresh();
    expect(history.entries()).toMatchObject([{ text: 'hello\n世界 🌍', cwd: '/project/one' }]);
    await history.record('from another directory', '/project/two');
    await history.refresh();
    expect(history.entries().map(entry => entry.text)).toEqual(['from another directory', 'hello\n世界 🌍']);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('merges concurrent writers without losing prompts', async () => {
    const file = await historyFile();
    const writers = Array.from({ length: 6 }, () => new TypedMessageHistory(file));
    await Promise.all(writers.map((writer, index) => writer.record(`prompt ${index}`, `/cwd/${index}`)));
    await writers[0].refresh();
    expect(new Set(writers[0].entries().map(entry => entry.text)).size).toBe(6);
  });

  it('ignores empty input and the recall command and bounds recent history', async () => {
    const history = new TypedMessageHistory();
    await history.record('  ', '/cwd');
    await history.record('/whatityped', '/cwd');
    expect(history.entries()).toEqual([]);
    for (let index = 0; index < 205; index++) await history.record(`prompt ${index}`, '/cwd');
    expect(history.entries()).toHaveLength(200);
    expect(history.entries()[0].text).toBe('prompt 204');
  });

  it('ignores malformed entries and recovers from invalid JSON', async () => {
    const file = await historyFile();
    await writeFile(file, '{broken');
    const history = new TypedMessageHistory(file);
    await history.refresh();
    expect(history.entries()).toEqual([]);
    await history.record('valid', '/cwd');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify([...saved, null, { text: 5 }]));
    await history.refresh();
    expect(history.entries().map(entry => entry.text)).toEqual(['valid']);
  });

  it('retains in-memory recall when persistence fails', async () => {
    const file = await historyFile();
    await writeFile(file, 'not a directory');
    const history = new TypedMessageHistory(path.join(file, 'history.json'));
    await expect(history.record('keep this', '/cwd')).rejects.toThrow();
    expect(history.entries()[0].text).toBe('keep this');
  });
});
