/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectExternalAgents, describeDetectedAgents } from '../../src/onboarding/externalAgents.js';

const homes: string[] = [];

async function createHome(...directories: string[]): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'autohand-external-agents-'));
  homes.push(home);
  for (const directory of directories) {
    await mkdir(path.join(home, directory), { recursive: true });
  }
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('detectExternalAgents', () => {
  it('returns nothing for a home directory without other agents', async () => {
    const home = await createHome();
    expect(await detectExternalAgents(home)).toEqual([]);
  });

  it('reports installed agents with their keybinding profile and import source', async () => {
    const home = await createHome('.codex', '.config/devin', '.gemini', '.autohand');

    const detected = await detectExternalAgents(home);

    expect(detected).toEqual([
      { id: 'codex', label: 'Codex', profile: 'codex', importSource: 'codex' },
      { id: 'devin', label: 'Devin', profile: 'devin' },
      { id: 'gemini', label: 'Google Gemini', importSource: 'gemini' },
    ]);
  });

  it('merges Claude Code under one entry for its profile and importer', async () => {
    const home = await createHome('.claude');

    expect(await detectExternalAgents(home)).toEqual([
      { id: 'claude-code', label: 'Claude Code', profile: 'claude-code', importSource: 'claude' },
    ]);
  });

  it('describes detected agents as a readable list', async () => {
    const home = await createHome('.claude', '.codex', '.factory');
    expect(describeDetectedAgents(await detectExternalAgents(home))).toBe('Claude Code, Codex and Factory Droid');
    expect(describeDetectedAgents([])).toBe('');
  });
});
