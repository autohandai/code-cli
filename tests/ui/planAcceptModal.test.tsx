/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../src/ui/i18n/index.js';
import { PlanAcceptPrompt, type PlanAcceptResult } from '../../src/ui/planAcceptModal.js';
import { ThemeProvider } from '../../src/ui/theme/ThemeContext.js';

const PLAN_PATH = path.join(os.homedir(), '.autohand', 'plans', 'plan-abc123.md');
const OPTIONS = [
  { id: 'clear_context_auto_accept', label: 'Yes, clear context and auto-accept edits', shortcut: 'shift+tab' },
  { id: 'manual_approve', label: 'Yes, and manually approve edits' },
];

function renderPrompt(onOpenPlan?: () => Promise<string | null>) {
  const onSubmit = vi.fn<(result: PlanAcceptResult) => void>();
  const rendered = render(
    <I18nProvider>
      <ThemeProvider>
        <PlanAcceptPrompt planFilePath={PLAN_PATH} options={OPTIONS} onSubmit={onSubmit} onOpenPlan={onOpenPlan} />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { ...rendered, onSubmit };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  cleanup();
});

describe('PlanAcceptPrompt', () => {
  it('says where the plan is saved, with the home directory shortened', () => {
    const { lastFrame } = renderPrompt();
    const frame = (lastFrame() ?? '').replace(/\s*\n\s*/gu, '');

    expect(frame).toContain('Would you like to proceed?');
    expect(frame).toContain(path.join('~', '.autohand', 'plans', 'plan-abc123.md'));
    expect(frame).not.toContain(os.homedir());
  });

  it('opens the plan on ctrl+g and confirms which program was started', async () => {
    const onOpenPlan = vi.fn(async () => 'code');
    const { stdin, lastFrame, onSubmit } = renderPrompt(onOpenPlan);
    await flush();

    stdin.write('\x07');
    await flush();

    expect(onOpenPlan).toHaveBeenCalledOnce();
    expect(lastFrame()).toContain('Opened with code');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says so when nothing could open the plan', async () => {
    const { stdin, lastFrame } = renderPrompt(async () => null);
    await flush();

    stdin.write('\x07');
    await flush();

    expect(lastFrame()).toContain('Could not open an editor');
  });

  it('survives an opener that throws', async () => {
    const { stdin, lastFrame, onSubmit } = renderPrompt(async () => {
      throw new Error('spawn failed');
    });
    await flush();

    stdin.write('\x07');
    await flush();

    expect(lastFrame()).toContain('Could not open an editor');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not advertise opening the plan when no opener is wired', () => {
    const { lastFrame } = renderPrompt();

    expect(lastFrame()).not.toContain('ctrl-g');
  });

  it('accepts the option that advertises shift+tab when shift+tab is pressed', async () => {
    const { stdin, onSubmit } = renderPrompt();
    await flush();

    stdin.write('\x1b[Z');
    await flush();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ type: 'option', optionId: 'clear_context_auto_accept' });
  });

  it('selects an option by number and maps "revise" to cancel', async () => {
    const first = renderPrompt();
    await flush();
    first.stdin.write('2');
    await flush();
    expect(first.onSubmit).toHaveBeenCalledExactlyOnceWith({ type: 'option', optionId: 'manual_approve' });
    cleanup();

    const second = renderPrompt();
    await flush();
    second.stdin.write('3');
    await flush();
    expect(second.onSubmit).toHaveBeenCalledExactlyOnceWith({ type: 'cancel' });
  });
});
