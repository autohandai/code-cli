/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadExternalKeybindingOverrides } from '../../src/keybindings/externalKeybindings.js';
import { formatChord, resolveKeybindings } from '../../src/keybindings/profiles.js';

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'autohand-keybindings-home-'));
  homes.push(home);
  return home;
}

async function writeHomeFile(home: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(home, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('loadExternalKeybindingOverrides', () => {
  it('returns no overrides when the agent has no keybinding file', async () => {
    const home = await createHome();
    expect(loadExternalKeybindingOverrides('claude-code', home)).toEqual({});
    expect(loadExternalKeybindingOverrides('codex', home)).toEqual({});
  });

  it('returns no overrides for profiles whose agent has no readable keymap', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.cursor/keybindings.json', '{"bindings":[]}');
    expect(loadExternalKeybindingOverrides('cursor', home)).toEqual({});
    expect(loadExternalKeybindingOverrides('autohand', home)).toEqual({});
  });

  it('adds Claude Code remaps to the profile chords and honours unbinding', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.claude/keybindings.json', JSON.stringify({
      bindings: [
        { context: 'Chat', bindings: { 'ctrl+n': 'chat:newline', 'ctrl+j': null, 'ctrl+x ctrl+e': 'chat:externalEditor' } },
        { context: 'Global', bindings: { 'ctrl+q': 'app:exit', 'ctrl+d': null, 'ctrl+y': 'app:unknownAction' } },
        { context: 'Transcript', bindings: { 'ctrl+n': 'transcript:toggleShowAll' } },
      ],
    }));

    const overrides = loadExternalKeybindingOverrides('claude-code', home);
    const resolved = resolveKeybindings('claude-code', overrides);

    expect(resolved.bindings.newline.map(formatChord)).toEqual(['shift + enter', 'alt + enter', 'ctrl + n']);
    expect(resolved.bindings.exit.map(formatChord)).toEqual(['ctrl + q']);
    expect(resolved.bindings.openHistory.map(formatChord)).toEqual(['ctrl + r']);
    expect(overrides).not.toHaveProperty('toggleLiveOutput');
  });

  it('maps every documented Claude Code action Autohand supports', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.claude/keybindings.json', JSON.stringify({
      bindings: [{
        context: 'Chat',
        bindings: {
          'ctrl+shift+m': 'chat:cycleMode',
          'ctrl+shift+o': 'app:toggleTranscript',
          'ctrl+shift+t': 'app:toggleTodos',
          'ctrl+shift+h': 'history:search',
        },
      }],
    }));

    const resolved = resolveKeybindings('claude-code', loadExternalKeybindingOverrides('claude-code', home));

    expect(resolved.bindings.cycleMode.map(formatChord)).toEqual(['shift + tab', 'ctrl + shift + m']);
    expect(resolved.bindings.toggleLiveOutput.map(formatChord)).toEqual(['ctrl + o', 'ctrl + shift + o']);
    expect(resolved.bindings.toggleGoals.map(formatChord)).toEqual(['ctrl + g', 'alt + g', 'ctrl + shift + t']);
    expect(resolved.bindings.openHistory.map(formatChord)).toEqual(['ctrl + r', 'ctrl + shift + h']);
  });

  it('reads Codex keymaps from config.toml with dash-separated keys', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.codex/config.toml', [
      'model = "gpt-5"',
      '',
      '[tui.keymap.composer]',
      'insert_newline = ["ctrl-j", "alt-enter"]',
      'history_search = "ctrl-h"',
      '',
      '[tui.keymap.global]',
      'exit = []',
    ].join('\n'));

    const resolved = resolveKeybindings('codex', loadExternalKeybindingOverrides('codex', home));

    expect(resolved.bindings.newline.map(formatChord)).toEqual(['ctrl + j', 'alt + enter']);
    expect(resolved.bindings.openHistory.map(formatChord)).toEqual(['ctrl + h']);
    expect(resolved.bindings.exit).toEqual([]);
  });

  it('ignores malformed files instead of throwing', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.claude/keybindings.json', '{"bindings": [');
    await writeHomeFile(home, '.codex/config.toml', '[tui.keymap.composer\ninsert_newline = "ctrl-j"');

    expect(loadExternalKeybindingOverrides('claude-code', home)).toEqual({});
    expect(loadExternalKeybindingOverrides('codex', home)).toEqual({});
  });

  it('ignores Claude Code files whose bindings are not the documented shape', async () => {
    const home = await createHome();
    await writeHomeFile(home, '.claude/keybindings.json', JSON.stringify({ bindings: { 'ctrl+n': 'chat:newline' } }));
    expect(loadExternalKeybindingOverrides('claude-code', home)).toEqual({});
  });
});
