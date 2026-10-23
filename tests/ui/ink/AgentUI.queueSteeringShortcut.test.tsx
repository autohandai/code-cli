import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { KEYBINDING_PROFILE_IDS, resolveKeybindings } from '../../../src/keybindings/profiles.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(cleanup);

function renderQueue(accepted = true, options: {
  isWorking?: boolean;
  queuedInstructions?: string[];
  enableQueueInput?: boolean;
  extension?: boolean;
} = {}) {
  const onInstruction = vi.fn(), onSteerQueuedInstruction = vi.fn(() => accepted);
  const onEscape = vi.fn(), onCtrlC = vi.fn(), onInputChange = vi.fn();
  const instance = render(
    <I18nProvider><ThemeProvider><AgentUI
      state={{ ...createInitialUIState(), isWorking: options.isWorking ?? true,
        queuedInstructions: options.queuedInstructions ?? ['Remember the worktrees', 'Check the tests'],
        queuedInstructionSequences: [41, 42] }}
      onInstruction={onInstruction} onEscape={onEscape} onCtrlC={onCtrlC}
      onSteerQueuedInstruction={onSteerQueuedInstruction} onInputChange={onInputChange}
      enableQueueInput={options.enableQueueInput ?? true}
      extensionKeybindings={options.extension ? [{ extensionId: 'fixture', key: 'ctrl+enter', command: '/help', when: 'always' }] : []}
    /></ThemeProvider></I18nProvider>,
  );
  const press = async (input: string) => {
    instance.stdin.write(input);
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  return { ...instance, press, onInstruction, onSteerQueuedInstruction, onEscape, onCtrlC, onInputChange };
}

describe('Ctrl+Enter queued conversation steering', () => {
  it.each(['\x1b[13;5u', '\x1b[27;5;13~'])('steers the next queued message from an empty composer with %j', async key => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press(key);
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledWith(0, 41, 'Remember the worktrees', 'Remember the worktrees'));
    expect(app.onInstruction).not.toHaveBeenCalled();
    expect(app.onEscape).not.toHaveBeenCalled();
    expect(app.onCtrlC).not.toHaveBeenCalled();
  });

  it('steers the highlighted row directly without loading it into the composer', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('\x1b[B'); await app.press('\x1b[B');
    await app.press('\x1b[13;5u');
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledWith(1, 42, 'Check the tests', 'Check the tests'));
    expect(app.onInputChange).not.toHaveBeenCalledWith('Check the tests');
  });

  it('preserves an unrelated composer draft when steering the next queued message', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('Keep this draft');
    await vi.waitFor(() => expect(app.onInputChange).toHaveBeenLastCalledWith('Keep this draft'));
    await app.press('\x1b[13;5u');
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledWith(0, 41, 'Remember the worktrees', 'Remember the worktrees'));
    expect(app.onInputChange).toHaveBeenLastCalledWith('Keep this draft');
    expect(app.onInstruction).not.toHaveBeenCalled();
  });

  it('preserves the selected message and draft if steering is rejected', async () => {
    const app = renderQueue(false);
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('Keep this draft'); await app.press('\x1b[13;5u');
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledOnce());
    expect(app.onInputChange).toHaveBeenLastCalledWith('Keep this draft');
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('Remember the worktrees');
  });

  it.each(['\x1b[13;5u', '\x1b[27;5;13~'])('steers a selected edit with its original queue identity using %j', async key => {
    const app = renderQueue(true, { extension: true });
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('\x1b[B'); await app.press('\r');
    await vi.waitFor(() => expect(app.onInputChange).toHaveBeenLastCalledWith('Remember the worktrees'));
    await app.press(' too'); await app.press(key);
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledWith(0, 41, 'Remember the worktrees', 'Remember the worktrees too'));
  });

  it.each(KEYBINDING_PROFILE_IDS)('documents the shortcut in the %s profile help panel', profile => {
    const help = resolveKeybindings(profile).helpRows().map(row => row.left + ' ' + row.right).join('\n');
    expect(help).toContain('ctrl + enter steers queued input');
  });

  it('ignores Ctrl+Enter key release and repeat events', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('Keep this draft');
    await app.press('\x1b[13;5u');
    await vi.waitFor(() => expect(app.onSteerQueuedInstruction).toHaveBeenCalledOnce());
    await app.press('\x1b[13;5:3u');
    await app.press('\x1b[13;5:2u');
    expect(app.onSteerQueuedInstruction).toHaveBeenCalledOnce();
    expect(app.onInstruction).not.toHaveBeenCalled();
    expect(app.onInputChange).toHaveBeenLastCalledWith('Keep this draft');
  });

  it.each([
    { isWorking: false },
    { queuedInstructions: [] },
    { enableQueueInput: false },
  ])('does not steer outside an enabled active queue: %j', async options => {
    const app = renderQueue(true, options);
    await new Promise<void>(resolve => setImmediate(resolve));
    await app.press('\x1b[13;5u');
    expect(app.onSteerQueuedInstruction).not.toHaveBeenCalled();
    expect(app.onEscape).not.toHaveBeenCalled();
    expect(app.onCtrlC).not.toHaveBeenCalled();
  });

  it('keeps plain Enter as queue submission', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('Another task'); await app.press('\r');
    await vi.waitFor(() => expect(app.onInstruction).toHaveBeenCalledWith('Another task'));
    expect(app.onSteerQueuedInstruction).not.toHaveBeenCalled();
  });

  it('does not interpret pasted escape text as a steering shortcut', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(app.lastFrame()).toContain('Queue · 2 pending'));
    await app.press('\x1b[200~[27;5;13~\x1b[201~');
    expect(app.onSteerQueuedInstruction).not.toHaveBeenCalled();
  });

  it('advertises the queue steering shortcut while messages are pending', async () => {
    const app = renderQueue();
    await vi.waitFor(() => expect(stripAnsi(app.lastFrame() ?? '')).toContain('ctrl+enter steer next'));
  });
});
