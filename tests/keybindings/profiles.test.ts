/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_ACTIONS,
  KEYBINDING_PROFILE_IDS,
  formatChord,
  getKeybindingProfile,
  matchesChord,
  parseChord,
  resolveKeybindings,
  type KeyEvent,
} from '../../src/keybindings/profiles.js';

const inkEvent = (input: string, key: Partial<KeyEvent> = {}): KeyEvent => ({
  input,
  ctrl: false,
  shift: false,
  meta: false,
  ...key,
});

describe('parseChord', () => {
  it('accepts plus and dash separators and modifier aliases', () => {
    expect(parseChord('ctrl+j')).toEqual({ key: 'j', ctrl: true, shift: false, meta: false });
    expect(parseChord('ctrl-j')).toEqual({ key: 'j', ctrl: true, shift: false, meta: false });
    expect(parseChord('Alt+Enter')).toEqual({ key: 'enter', ctrl: false, shift: false, meta: true });
    expect(parseChord('opt+return')).toEqual({ key: 'enter', ctrl: false, shift: false, meta: true });
    expect(parseChord('meta+t')).toEqual({ key: 't', ctrl: false, shift: false, meta: true });
    expect(parseChord('shift+tab')).toEqual({ key: 'tab', ctrl: false, shift: true, meta: false });
    expect(parseChord('esc')).toEqual({ key: 'escape', ctrl: false, shift: false, meta: false });
    expect(parseChord('?')).toEqual({ key: '?', ctrl: false, shift: false, meta: false });
  });

  it('rejects multi-keystroke chords, unknown modifiers, and empty specs', () => {
    expect(parseChord('ctrl+x ctrl+e')).toBeNull();
    expect(parseChord('hyper+j')).toBeNull();
    expect(parseChord('')).toBeNull();
    expect(parseChord('ctrl+')).toBeNull();
  });

  it('formats chords the way the help panel shows them', () => {
    expect(formatChord(parseChord('ctrl+j')!)).toBe('ctrl + j');
    expect(formatChord(parseChord('shift+enter')!)).toBe('shift + enter');
    expect(formatChord(parseChord('alt+enter')!)).toBe('alt + enter');
    expect(formatChord(parseChord('?')!)).toBe('?');
  });
});

describe('matchesChord', () => {
  it('matches Ink-shaped events by modifiers and lower-cased input', () => {
    const chord = parseChord('ctrl+j')!;
    expect(matchesChord(chord, inkEvent('j', { ctrl: true }))).toBe(true);
    expect(matchesChord(chord, inkEvent('J', { ctrl: true }))).toBe(true);
    expect(matchesChord(chord, inkEvent('j'))).toBe(false);
    expect(matchesChord(chord, inkEvent('j', { ctrl: true, shift: true }))).toBe(false);
  });

  it('matches the raw line feed that a terminal sends for Ctrl+J', () => {
    expect(matchesChord(parseChord('ctrl+j')!, inkEvent('\n'))).toBe(true);
    expect(matchesChord(parseChord('ctrl+j')!, inkEvent('\r', { name: 'return' }))).toBe(false);
  });

  it('matches named keys through the event name', () => {
    expect(matchesChord(parseChord('shift+tab')!, inkEvent('', { name: 'tab', shift: true }))).toBe(true);
    expect(matchesChord(parseChord('shift+tab')!, inkEvent('', { name: 'tab' }))).toBe(false);
    expect(matchesChord(parseChord('shift+enter')!, inkEvent('\r', { name: 'return', shift: true }))).toBe(true);
    expect(matchesChord(parseChord('alt+enter')!, inkEvent('\r', { name: 'return', meta: true }))).toBe(true);
    expect(matchesChord(parseChord('escape')!, inkEvent('', { name: 'escape' }))).toBe(true);
    expect(matchesChord(parseChord('ctrl+d')!, inkEvent('d', { ctrl: true }))).toBe(true);
  });

  it('treats ? as a plain key that needs no modifiers', () => {
    expect(matchesChord(parseChord('?')!, inkEvent('?'))).toBe(true);
    expect(matchesChord(parseChord('?')!, inkEvent('?', { shift: true }))).toBe(true);
    expect(matchesChord(parseChord('?')!, inkEvent('?', { ctrl: true }))).toBe(false);
  });
});

describe('keybinding profiles', () => {
  it('resolves every profile to a full binding table', () => {
    for (const id of KEYBINDING_PROFILE_IDS) {
      const resolved = resolveKeybindings(id);
      expect(resolved.profile).toBe(id);
      for (const action of KEYBINDING_ACTIONS) {
        expect(Array.isArray(resolved.bindings[action])).toBe(true);
      }
      expect(resolved.bindings.cycleMode.map(formatChord)).toContain('shift + tab');
      expect(getKeybindingProfile(id).homeDirectories.length).toBeGreaterThan(0);
    }
  });

  it('keeps Autohand defaults without exit or history chords', () => {
    expect(DEFAULT_KEYBINDINGS.profile).toBe('autohand');
    expect(DEFAULT_KEYBINDINGS.bindings.exit).toEqual([]);
    expect(DEFAULT_KEYBINDINGS.bindings.openHistory).toEqual([]);
    expect(DEFAULT_KEYBINDINGS.bindings.newline.map(formatChord)).toEqual(['shift + enter', 'alt + enter']);
    expect(DEFAULT_KEYBINDINGS.matches('exit', inkEvent('d', { ctrl: true }))).toBe(false);
  });

  it('gives the Codex profile Ctrl+J, Ctrl+D and Ctrl+R on top of the defaults', () => {
    const codex = resolveKeybindings('codex');
    expect(codex.bindings.newline.map(formatChord)).toEqual(['shift + enter', 'alt + enter', 'ctrl + j']);
    expect(codex.bindings.exit.map(formatChord)).toEqual(['ctrl + d']);
    expect(codex.bindings.openHistory.map(formatChord)).toEqual(['ctrl + r']);
    expect(codex.matches('newline', inkEvent('\n'))).toBe(true);
    expect(codex.matches('exit', inkEvent('d', { ctrl: true }))).toBe(true);
    expect(codex.matches('openHistory', inkEvent('r', { ctrl: true }))).toBe(true);
  });

  it('keeps Factory on Ctrl+C twice because Droid has no Ctrl+D exit', () => {
    expect(resolveKeybindings('factory').bindings.exit).toEqual([]);
  });

  it('applies overrides by replacing a profile action and unbinding with an empty list', () => {
    const resolved = resolveKeybindings('claude-code', { newline: ['ctrl+n'], exit: [] });
    expect(resolved.bindings.newline.map(formatChord)).toEqual(['ctrl + n']);
    expect(resolved.bindings.exit).toEqual([]);
    expect(resolved.bindings.openHistory.map(formatChord)).toEqual(['ctrl + r']);
  });

  it('drops override chords that cannot be parsed instead of failing', () => {
    const resolved = resolveKeybindings('codex', { newline: ['ctrl+x ctrl+e', 'ctrl+n'] });
    expect(resolved.bindings.newline.map(formatChord)).toEqual(['ctrl + n']);
  });

  it('reserves the active chords so extensions cannot shadow them', () => {
    expect(resolveKeybindings('codex').reservedChords().has('ctrl+d')).toBe(true);
    expect(DEFAULT_KEYBINDINGS.reservedChords().has('ctrl+d')).toBe(false);
    expect(DEFAULT_KEYBINDINGS.reservedChords().has('shift+tab')).toBe(true);
    expect(DEFAULT_KEYBINDINGS.reservedChords().has('ctrl+t')).toBe(true);
    expect(DEFAULT_KEYBINDINGS.reservedChords().has('meta+g')).toBe(true);
  });

  it('describes the active chords for the shortcuts panel', () => {
    const rows = resolveKeybindings('codex').helpRows();
    const cells = rows.flatMap((row) => [row.left, row.right]);
    expect(cells).toContain('shift + tab cycles interaction modes');
    expect(cells).toContain('ctrl + j inserts newline');
    expect(cells).toContain('ctrl + d exits');
    expect(cells).toContain('ctrl + r opens history');
    const defaults = DEFAULT_KEYBINDINGS.helpRows().flatMap((row) => [row.left, row.right]);
    expect(defaults).toContain('shift + enter inserts newline');
    expect(defaults).not.toContain('ctrl + d exits');
    expect(defaults).toContain('esc interrupts active turn');
  });
});
