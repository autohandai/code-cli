/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../../../src/session/SessionManager.js';
import { autoNameAgentSessionFromInstruction, refineAgentSessionTitle, syncAgentTerminalTitleName } from '../../../src/core/agent/AgentSessionTitle.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function host(refined: string | null = 'Fix caret after startup') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-title-'));
  roots.push(root);
  const sessionManager = new SessionManager(path.join(root, 'sessions'));
  await sessionManager.initialize();
  await sessionManager.createSession('/work/project', 'fantail');
  const terminalTitle = { setName: vi.fn() };
  return {
    sessionManager,
    terminalTitle,
    sessionAutoNamer: { refine: vi.fn().mockResolvedValue(refined) },
    sessionTitleRefined: false,
    conversation: { history: () => [{ role: 'user', content: 'fix the caret' }, { role: 'assistant', content: 'done' }] },
  };
}

describe('session titles', () => {
  it('names an unnamed session from the first instruction and updates the terminal title', async () => {
    const h = await host();
    await autoNameAgentSessionFromInstruction(h, 'fix the caret after startup please');
    expect(h.sessionManager.getCurrentSession()?.metadata).toMatchObject({ title: 'Fix the caret after startup please', titleSource: 'auto' });
    expect(h.terminalTitle.setName).toHaveBeenLastCalledWith('Fix the caret after startup please');

    await autoNameAgentSessionFromInstruction(h, 'something else entirely');
    expect(h.sessionManager.getCurrentSession()?.metadata.title).toBe('Fix the caret after startup please');
  });

  it('ignores commands and leaves a user-given name alone', async () => {
    const h = await host();
    await autoNameAgentSessionFromInstruction(h, '/help');
    expect(h.sessionManager.getCurrentSession()?.metadata.title).toBeUndefined();
    await h.sessionManager.renameCurrentSession('My name', { source: 'user' });
    await autoNameAgentSessionFromInstruction(h, 'fix the caret');
    expect(h.sessionManager.getCurrentSession()?.metadata.title).toBe('My name');
  });

  it('refines an automatic name once with the model and never overwrites a user name', async () => {
    const h = await host();
    await autoNameAgentSessionFromInstruction(h, 'fix the caret after startup please');
    await refineAgentSessionTitle(h);
    expect(h.sessionManager.getCurrentSession()?.metadata).toMatchObject({ title: 'Fix caret after startup', titleSource: 'auto' });
    expect(h.terminalTitle.setName).toHaveBeenLastCalledWith('Fix caret after startup');
    expect(h.sessionTitleRefined).toBe(true);

    await refineAgentSessionTitle(h);
    expect(h.sessionAutoNamer.refine).toHaveBeenCalledTimes(1);

    const user = await host('Model name');
    await user.sessionManager.renameCurrentSession('Typed by me', { source: 'user' });
    await refineAgentSessionTitle(user);
    expect(user.sessionAutoNamer.refine).not.toHaveBeenCalled();
    expect(user.sessionManager.getCurrentSession()?.metadata.title).toBe('Typed by me');
  });

  it('does nothing when the host has no conversation to refine from', async () => {
    const h = await host();
    await autoNameAgentSessionFromInstruction(h, 'fix the caret after startup please');
    const bare = { ...h, conversation: undefined };
    await expect(refineAgentSessionTitle(bare)).resolves.toBeUndefined();
    expect(h.sessionAutoNamer.refine).not.toHaveBeenCalled();
    expect(bare.sessionTitleRefined).toBe(false);
  });

  it('keeps the derived name when the model returns nothing', async () => {
    const h = await host(null);
    await autoNameAgentSessionFromInstruction(h, 'ship the release');
    await refineAgentSessionTitle(h);
    expect(h.sessionManager.getCurrentSession()?.metadata.title).toBe('Ship the release');
  });

  it('syncs the display name into the terminal title', async () => {
    const h = await host();
    syncAgentTerminalTitleName(h);
    expect(h.terminalTitle.setName).toHaveBeenLastCalledWith(undefined);
    await h.sessionManager.renameCurrentSession('Named', { source: 'user' });
    syncAgentTerminalTitleName(h);
    expect(h.terminalTitle.setName).toHaveBeenLastCalledWith('Named');
  });
});
