/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

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

    expect(immediateHandler).not.toHaveBeenCalled();
    expect(queueHandler).toHaveBeenCalledWith('fix', 1);
    expect(pi.hasQueued()).toBe(true);
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
});
