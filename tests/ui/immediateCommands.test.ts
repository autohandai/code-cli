/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Immediate command detection - isImmediateCommand', () => {
  let isImmediateCommand: typeof import('../../src/ui/shellCommand.js').isImmediateCommand;

  beforeEach(async () => {
    const module = await import('../../src/ui/shellCommand.js');
    isImmediateCommand = module.isImmediateCommand;
  });

  it('should return true for shell commands starting with !', () => {
    expect(isImmediateCommand('! ls -la')).toBe(true);
    expect(isImmediateCommand('!git status')).toBe(true);
    expect(isImmediateCommand('!  pwd')).toBe(true);
  });

  it('should return true for slash commands starting with /', () => {
    expect(isImmediateCommand('/help')).toBe(true);
    expect(isImmediateCommand('/model')).toBe(true);
    expect(isImmediateCommand('/quit')).toBe(true);
    expect(isImmediateCommand('/exit')).toBe(true);
  });

  it('should return false for regular prompts', () => {
    expect(isImmediateCommand('fix the bug in auth')).toBe(false);
    expect(isImmediateCommand('add a new feature')).toBe(false);
    expect(isImmediateCommand('explain this code')).toBe(false);
  });

  it('should return false for empty input', () => {
    expect(isImmediateCommand('')).toBe(false);
    expect(isImmediateCommand('   ')).toBe(false);
  });

  it('should return false for bare ! with no command', () => {
    expect(isImmediateCommand('!')).toBe(false);
    expect(isImmediateCommand('!  ')).toBe(false);
  });

  it('should return false for bare / with no command', () => {
    expect(isImmediateCommand('/')).toBe(false);
    expect(isImmediateCommand('/  ')).toBe(false);
  });

  it('should return false for ! or / in middle of text', () => {
    expect(isImmediateCommand('hello! world')).toBe(false);
    expect(isImmediateCommand('path/to/file')).toBe(false);
  });
});

describe('PersistentInput immediate command handling', () => {
  let PersistentInput: typeof import('../../src/ui/persistentInput.js').PersistentInput;
  let getPlanModeManager: typeof import('../../src/commands/plan.js').getPlanModeManager;

  beforeEach(async () => {
    const resetModules = (vi as unknown as { resetModules?: () => void }).resetModules;
    resetModules?.();
    const module = await import('../../src/ui/persistentInput.js');
    const planModule = await import('../../src/commands/plan.js');
    PersistentInput = module.PersistentInput;
    getPlanModeManager = planModule.getPlanModeManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should emit immediate-command instead of queuing for ! commands', () => {
    const pi = new PersistentInput({ silentMode: true });
    // Bypass start() which needs TTY - set isActive directly
    (pi as any).isActive = true;

    const immediateHandler = vi.fn();
    const queueHandler = vi.fn();

    pi.on('immediate-command', immediateHandler);
    pi.on('queued', queueHandler);

    const handler = (pi as any).handleKeypress;

    handler('!', { name: undefined });
    handler(' ', { name: undefined });
    handler('l', { name: undefined });
    handler('s', { name: undefined });
    handler('', { name: 'return' });

    expect(immediateHandler).toHaveBeenCalledWith('! ls');
    expect(queueHandler).not.toHaveBeenCalled();
    expect(pi.hasQueued()).toBe(false);
  });

  it('should emit immediate-command instead of queuing for / commands', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;

    const immediateHandler = vi.fn();
    const queueHandler = vi.fn();

    pi.on('immediate-command', immediateHandler);
    pi.on('queued', queueHandler);

    const handler = (pi as any).handleKeypress;

    handler('/', { name: undefined });
    handler('h', { name: undefined });
    handler('e', { name: undefined });
    handler('l', { name: undefined });
    handler('p', { name: undefined });
    handler('', { name: 'return' });

    expect(immediateHandler).toHaveBeenCalledWith('/help');
    expect(queueHandler).not.toHaveBeenCalled();
    expect(pi.hasQueued()).toBe(false);
  });

  it('should queue regular prompts normally', () => {
    vi.useFakeTimers();
    try {
      const pi = new PersistentInput({ silentMode: true });
      (pi as any).isActive = true;

      const immediateHandler = vi.fn();
      const queueHandler = vi.fn();

      pi.on('immediate-command', immediateHandler);
      pi.on('queued', queueHandler);

      const handler = (pi as any).handleKeypress;

      handler('f', { name: undefined });
      handler('i', { name: undefined });
      handler('x', { name: undefined });
      handler('', { name: 'return' });

      // Flush the rapid-Enter debounce timer
      vi.advanceTimersByTime(100);

      expect(immediateHandler).not.toHaveBeenCalled();
      expect(queueHandler).toHaveBeenCalledWith('fix', 1);
      expect(pi.hasQueued()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should clear currentInput after immediate command', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;

    pi.on('immediate-command', () => {});

    const handler = (pi as any).handleKeypress;

    handler('!', { name: undefined });
    handler('l', { name: undefined });
    handler('s', { name: undefined });
    handler('', { name: 'return' });

    expect(pi.getCurrentInput()).toBe('');
  });

  it('emits input-change events while editing and after submit', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;

    const handler = (pi as any).handleKeypress;
    const changes: string[] = [];
    pi.on('input-change', (value: string) => changes.push(value));

    handler('h', { name: undefined });
    handler('i', { name: undefined });
    handler('', { name: 'backspace' });
    handler('', { name: 'return' });

    expect(changes).toEqual(['h', 'hi', 'h', '']);
  });

  it('setCurrentInput updates draft text directly', () => {
    const pi = new PersistentInput({ silentMode: true });

    pi.setCurrentInput('draft message');

    expect(pi.getCurrentInput()).toBe('draft message');
  });

  it('pause anchors cursor before disabling regions', () => {
    const pi = new PersistentInput({ silentMode: false });
    const focusScrollBottom = vi.fn();
    const disable = vi.fn();

    (pi as any).isActive = true;
    (pi as any).regions = {
      focusScrollBottom,
      disable,
      enable: vi.fn(),
    };

    pi.pause();

    expect(focusScrollBottom).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);
    expect(focusScrollBottom.mock.invocationCallOrder[0]).toBeLessThan(
      disable.mock.invocationCallOrder[0]
    );
  });

  it('pause and resume skip terminal regions when running in silent mode', () => {
    const pi = new PersistentInput({ silentMode: true });
    const focusScrollBottom = vi.fn();
    const disable = vi.fn();
    const enable = vi.fn();
    const render = vi.fn();

    (pi as any).isActive = true;
    (pi as any)._supportsRaw = true;
    (pi as any).input = {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
    };
    (pi as any).regions = {
      focusScrollBottom,
      disable,
      enable,
    };
    (pi as any).render = render;

    pi.pause();
    pi.resume();

    expect(focusScrollBottom).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('start resumes stdin so queue typing works after readline prompt closes', () => {
    const pi = new PersistentInput({ silentMode: true });
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const resume = vi.fn();
    const setRawMode = vi.fn();

    (mockInput as any).isTTY = true;
    (mockInput as any).resume = resume;
    (mockInput as any).setRawMode = setRawMode;
    (mockInput as any).isRaw = false;
    (pi as any).input = mockInput;

    pi.start();

    expect(resume).toHaveBeenCalled();
  });

  it('resume resumes stdin and redraws regions after pause', () => {
    const pi = new PersistentInput({ silentMode: false });
    const mockInput = new EventEmitter() as NodeJS.ReadStream;
    const resume = vi.fn();
    const setRawMode = vi.fn();
    const enable = vi.fn();
    const renderFixedRegion = vi.fn();

    (mockInput as any).isTTY = true;
    (mockInput as any).resume = resume;
    (mockInput as any).setRawMode = setRawMode;
    (mockInput as any).isRaw = false;
    (pi as any).input = mockInput;
    (pi as any).isActive = true;
    (pi as any).isPaused = true;
    (pi as any)._supportsRaw = true;
    (pi as any).regions = {
      enable,
      renderFixedRegion,
      updateInput: vi.fn(),
      updateStatus: vi.fn(),
      updateActivity: vi.fn(),
      disable: vi.fn(),
      focusScrollBottom: vi.fn(),
      writeAbove: vi.fn(),
    };

    pi.resume();

    expect(resume).toHaveBeenCalled();
    expect(enable).toHaveBeenCalled();
    expect(setRawMode).toHaveBeenCalledWith(true);
    expect(renderFixedRegion).toHaveBeenCalled();
  });

  it('Shift+Tab toggles plan mode and emits plan-mode-toggled while working', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;
    const manager = getPlanModeManager();
    manager.disable();

    const toggled: boolean[] = [];
    pi.on('plan-mode-toggled', (enabled: boolean) => toggled.push(enabled));

    const handler = (pi as any).handleKeypress;
    handler('\u001b[Z', { name: 'backtab', shift: true });
    handler('\u001b[Z', { name: 'backtab', shift: true });

    expect(toggled).toEqual([true, false]);
    expect(pi.getCurrentInput()).toBe('');
    manager.disable();
  });

  it('Tab accepts shell command completion while composing ! command', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;

    const handler = (pi as any).handleKeypress;
    handler('!', { name: undefined });
    handler('g', { name: undefined });
    handler('i', { name: undefined });
    handler('\t', { name: 'tab', sequence: '\t' });

    expect(pi.getCurrentInput()).toBe('! git ');
  });

  it('Tab completes shell path suggestions using workspaceRoot', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-pi-shell-'));
    fs.mkdirSync(path.join(tempDir, 'build'), { recursive: true });

    const pi = new PersistentInput({ silentMode: true, workspaceRoot: tempDir });
    (pi as any).isActive = true;

    const handler = (pi as any).handleKeypress;
    handler('!', { name: undefined });
    handler(' ', { name: undefined });
    handler('c', { name: undefined });
    handler('d', { name: undefined });
    handler(' ', { name: undefined });
    handler('b', { name: undefined });
    handler('u', { name: undefined });
    handler('\t', { name: 'tab', sequence: '\t' });

    expect(pi.getCurrentInput()).toBe('! cd build/');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Tab uses async resolver suggestion for ! commands when provided', async () => {
    const resolveShellSuggestion = vi.fn(async () => '! git status');
    const pi = new PersistentInput({
      silentMode: true,
      resolveShellSuggestion,
    });
    (pi as any).isActive = true;

    const handler = (pi as any).handleKeypress;
    handler('!', { name: undefined });
    handler('g', { name: undefined });
    handler('i', { name: undefined });
    handler('\t', { name: 'tab', sequence: '\t' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveShellSuggestion).toHaveBeenCalledWith('!gi');
    expect(pi.getCurrentInput()).toBe('! git status');
  });

  it('Tab applies local fallback immediately when async resolver is pending', () => {
    const resolveShellSuggestion = vi.fn(
      () => new Promise<string | null>(() => { /* intentionally pending */ })
    );
    const pi = new PersistentInput({
      silentMode: true,
      resolveShellSuggestion,
    });
    (pi as any).isActive = true;

    const handler = (pi as any).handleKeypress;
    handler('!', { name: undefined });
    handler(' ', { name: undefined });
    handler('g', { name: undefined });
    handler('i', { name: undefined });
    handler('t', { name: undefined });
    handler(' ', { name: undefined });
    handler('s', { name: undefined });
    handler('\t', { name: 'tab', sequence: '\t' });

    expect(resolveShellSuggestion).toHaveBeenCalledWith('! git s');
    expect(pi.getCurrentInput()).toBe('! git status');
  });

  it('Ctrl+Q opens queue browser and Enter pulls selected item into composer for editing', () => {
    vi.useFakeTimers();
    try {
      const pi = new PersistentInput({ silentMode: true });
      (pi as any).isActive = true;

      const handler = (pi as any).handleKeypress;

      handler('f', { name: undefined });
      handler('i', { name: undefined });
      handler('r', { name: undefined });
      handler('s', { name: undefined });
      handler('t', { name: undefined });
      handler('', { name: 'return' });
      vi.advanceTimersByTime(100);

      handler('s', { name: undefined });
      handler('e', { name: undefined });
      handler('c', { name: undefined });
      handler('o', { name: undefined });
      handler('n', { name: undefined });
      handler('d', { name: undefined });
      handler('', { name: 'return' });
      vi.advanceTimersByTime(100);

      expect(pi.getQueueLength()).toBe(2);

      handler('', { name: 'q', ctrl: true, sequence: '\x11' }); // open queue browser
      expect(pi.getCurrentInput()).toBe('');
      expect(pi.getQueueLength()).toBe(2);
      handler('', { name: 'return' }); // pull selected (latest)

      expect(pi.getCurrentInput()).toBe('second');
      expect(pi.getQueueLength()).toBe(1);
      expect(pi.dequeue()?.text).toBe('first');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Ctrl+Q writes queue snapshot above composer in terminal regions mode', () => {
    const pi = new PersistentInput({ silentMode: false });
    (pi as any).isActive = true;
    (pi as any).queue = [
      { text: 'first item', timestamp: 1 },
      { text: 'second item', timestamp: 2 },
    ];

    const writeAbove = vi.fn();
    const updateInput = vi.fn();
    const updateStatus = vi.fn();
    (pi as any).regions = {
      writeAbove,
      updateInput,
      updateStatus,
      renderFixedRegion: vi.fn(),
      updateActivity: vi.fn(),
      disable: vi.fn(),
      focusScrollBottom: vi.fn(),
      enable: vi.fn(),
    };

    const handler = (pi as any).handleKeypress;
    handler('', { name: 'q', ctrl: true, sequence: '\x11' });

    expect(writeAbove).toHaveBeenCalledTimes(1);
    const output = String(writeAbove.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('Queued requests (2)');
    expect(output).toContain('1. "first item"');
    expect(output).toContain('2. "second item"');
    expect(output).toContain('Enter to edit');
    expect(output).not.toContain('🧾');
    expect(output).not.toContain('✎');
    expect(updateInput).not.toHaveBeenCalled();
    expect(pi.getQueueLength()).toBe(2);
  });

  it('queue browser supports up/down selection before pulling with Enter', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;
    (pi as any).queue = [
      { text: 'first item', timestamp: 1 },
      { text: 'second item', timestamp: 2 },
      { text: 'third item', timestamp: 3 },
    ];

    const handler = (pi as any).handleKeypress;
    handler('', { name: 'q', ctrl: true, sequence: '\x11' }); // select latest: third
    handler('', { name: 'up' }); // second
    handler('', { name: 'return' }); // pull second

    expect(pi.getCurrentInput()).toBe('second item');
    expect(pi.getQueueLength()).toBe(2);
    expect(pi.dequeue()?.text).toBe('first item');
    expect(pi.dequeue()?.text).toBe('third item');
  });

  it('queue browser supports removing selected item with Backspace', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;
    (pi as any).queue = [
      { text: 'first item', timestamp: 1 },
      { text: 'second item', timestamp: 2 },
      { text: 'third item', timestamp: 3 },
    ];

    const handler = (pi as any).handleKeypress;
    handler('', { name: 'q', ctrl: true, sequence: '\x11' }); // latest selected: third
    handler('', { name: 'up' }); // select second
    handler('', { name: 'backspace' }); // remove second

    expect(pi.getQueueLength()).toBe(2);
    expect(pi.dequeue()?.text).toBe('first item');
    expect(pi.dequeue()?.text).toBe('third item');
  });

  it('Ctrl+Q reports empty queue without changing input', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;
    pi.setCurrentInput('draft');

    const handler = (pi as any).handleKeypress;
    handler('', { name: 'q', ctrl: true, sequence: '\x11' });

    expect(pi.getCurrentInput()).toBe('draft');
    expect(pi.getQueueLength()).toBe(0);
  });

  it('shows shortcut help when ? is typed on empty draft in terminal regions mode', () => {
    const pi = new PersistentInput({ silentMode: false });
    (pi as any).isActive = true;

    const writeAbove = vi.fn();
    (pi as any).regions = {
      writeAbove,
      updateInput: vi.fn(),
      updateStatus: vi.fn(),
      renderFixedRegion: vi.fn(),
      updateActivity: vi.fn(),
      disable: vi.fn(),
      focusScrollBottom: vi.fn(),
      enable: vi.fn(),
    };

    const handler = (pi as any).handleKeypress;
    handler('?', { name: undefined, ctrl: false, meta: false });

    expect(writeAbove).toHaveBeenCalledTimes(1);
    const output = String(writeAbove.mock.calls[0]?.[0] ?? '');
    expect(output).toContain('Shortcuts');
    expect(output).toContain('/ commands');
    expect(output).toContain('Ctrl+Q queue browser');
    expect(pi.getCurrentInput()).toBe('');
  });

  it('? behaves as normal character when draft is not empty', () => {
    const pi = new PersistentInput({ silentMode: true });
    (pi as any).isActive = true;
    pi.setCurrentInput('why');

    const handler = (pi as any).handleKeypress;
    handler('?', { name: undefined, ctrl: false, meta: false });

    expect(pi.getCurrentInput()).toBe('why?');
  });
});
