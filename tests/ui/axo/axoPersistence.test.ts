/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

const { readAxoEnabled, writeAxoEnabled } = await vi.importActual<
  typeof import('../../../src/ui/axo/axoStateFile.js')
>('../../../src/ui/axo/axoStateFile.js');

let directory: string | null = null;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe('Axo state file', () => {
  it('round-trips, creating the folder, and reads anything odd as away', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'axo-'));
    const file = path.join(directory, 'nested', 'axo.json');
    expect(readAxoEnabled(file)).toBe(false);
    await writeAxoEnabled(true, file);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ enabled: true });
    expect(readAxoEnabled(file)).toBe(true);
    await writeFile(file, 'not json');
    expect(readAxoEnabled(file)).toBe(false);
    await writeFile(file, JSON.stringify({ enabled: 'yes' }));
    expect(readAxoEnabled(file)).toBe(false);
  });
});

describe('InkRenderer and Axo', () => {
  function renderer(
    loadAxoEnabled = () => false,
    askAxo?: (question: string, signal: AbortSignal) => Promise<string | null>,
  ) {
    const saveAxoEnabled = vi.fn();
    const instance = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
      loadAxoEnabled,
      saveAxoEnabled,
      ...(askAxo ? { askAxo } : {}),
    });
    return { instance, saveAxoEnabled };
  }

  it('thinks, then shows the model\'s answer to a question', async () => {
    let resolve: (answer: string | null) => void = () => {};
    const askAxo = vi.fn((_question: string, _signal: AbortSignal) => new Promise<string | null>((done) => { resolve = done; }));
    const { instance } = renderer(() => true, askAxo);
    instance.handleAxoCommand({ kind: 'say', text: 'what is a monad?' });
    expect(instance.getState().axo?.cue).toMatchObject({ kind: 'think', text: 'what is a monad?' });
    expect(askAxo).toHaveBeenCalledWith('what is a monad?', expect.any(AbortSignal));
    resolve('A burrito for values!');
    await vi.waitFor(() => expect(instance.getState().axo?.cue).toMatchObject({ kind: 'answer', text: 'A burrito for values!' }));
  });

  it('shrugs when no model answers, and drops answers that arrive too late', async () => {
    const answers: Array<(answer: string | null) => void> = [];
    const signals: AbortSignal[] = [];
    const askAxo = (_question: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string | null>((done) => answers.push(done));
    };
    const { instance } = renderer(() => true, askAxo);
    instance.handleAxoCommand({ kind: 'say', text: 'first?' });
    instance.handleAxoCommand({ kind: 'say', text: 'second?' });
    expect(signals[0]?.aborted).toBe(true);
    answers[0]?.('stale');
    answers[1]?.(null);
    await vi.waitFor(() => expect(instance.getState().axo?.cue?.kind).toBe('answer'));
    expect(instance.getState().axo?.cue?.text).not.toBe('stale');
    expect(instance.getState().axo?.cue?.text).toMatch(/offline/);
  });

  it('cancels a pending answer when Axo goes home', () => {
    const signals: AbortSignal[] = [];
    const { instance } = renderer(() => true, (_q, signal) => {
      signals.push(signal);
      return new Promise<string | null>(() => {});
    });
    instance.handleAxoCommand({ kind: 'say', text: 'hello?' });
    instance.sendAxoHome();
    expect(signals[0]?.aborted).toBe(true);
    expect(instance.getState().axo?.enabled).toBe(false);
  });

  it('remembers Axo from last session', () => {
    expect(renderer(() => true).instance.getState().axo?.enabled).toBe(true);
    expect(renderer().instance.getState().axo?.enabled).toBe(false);
  });

  it('summons and sends Axo home, persisting only real changes', () => {
    const { instance, saveAxoEnabled } = renderer();
    instance.handleAxoCommand({ kind: 'summon' });
    expect(instance.getState().axo).toMatchObject({ enabled: true, cue: { kind: 'hello' } });
    instance.handleAxoCommand({ kind: 'pet' });
    expect(saveAxoEnabled.mock.calls).toEqual([[true]]);
    instance.handleAxoCommand({ kind: 'home' });
    expect(instance.getState().axo?.enabled).toBe(true);
    instance.sendAxoHome();
    expect(instance.getState().axo?.enabled).toBe(false);
    expect(saveAxoEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps Axo through /clear and /new', () => {
    const { instance } = renderer(() => true);
    instance.reset();
    expect(instance.getState().axo?.enabled).toBe(true);
  });

  it('records how a turn ended, even without a summary row', () => {
    const { instance } = renderer();
    instance.setWorking(true, 'Working');
    instance.setWorking(false, '', { succeeded: false });
    expect(instance.getState().lastTurnOutcome).toBe('failed');
    instance.setWorking(true, 'Working');
    expect(instance.getState().lastTurnOutcome).toBeUndefined();
  });
});
