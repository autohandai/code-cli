/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { writeAutohandDebugLine } from '../utils/debugLog.js';
import {
  DEFAULT_BINDING_SPECS,
  getKeybindingProfile,
  normalizeChord,
  parseChord,
  type KeybindingAction,
  type KeybindingOverrides,
  type KeybindingProfileId,
} from './profiles.js';

/**
 * Overlays a user's own remaps from another agent onto a profile. Only Claude
 * Code and Codex document their keymap files; other profiles get defaults.
 * Reads are synchronous because they run once, at UI start, on tiny files.
 */
export function loadExternalKeybindingOverrides(
  profile: KeybindingProfileId,
  homeDir: string = os.homedir(),
): KeybindingOverrides {
  try {
    if (profile === 'claude-code') {
      return readClaudeCodeOverrides(path.join(homeDir, '.claude', 'keybindings.json'));
    }
    if (profile === 'codex') {
      return readCodexOverrides(path.join(homeDir, '.codex', 'config.toml'));
    }
  } catch (error) {
    writeAutohandDebugLine(
      `[DEBUG] Ignoring ${profile} keybinding overrides: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {};
}

/** Claude Code `context:action` ids that have an Autohand equivalent. */
export const CLAUDE_CODE_ACTION_MAP: Readonly<Record<string, KeybindingAction>> = {
  'chat:cycleMode': 'cycleMode',
  'chat:newline': 'newline',
  'app:exit': 'exit',
  'app:toggleTranscript': 'toggleLiveOutput',
  'app:toggleTodos': 'toggleGoals',
  'history:search': 'openHistory',
};

/** Codex `[tui.keymap.<context>]` keys that have an Autohand equivalent. */
export const CODEX_ACTION_MAP: Readonly<Record<string, KeybindingAction>> = {
  'composer.insert_newline': 'newline',
  'composer.history_search': 'openHistory',
  'global.exit': 'exit',
};

const CLAUDE_CODE_CONTEXTS = new Set(['Chat', 'Global']);

function readOptionalFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Claude Code bindings are edits on top of its defaults, so they are applied
 * as edits on top of the profile: a string action adds the chord, `null`
 * removes it. Only actions that actually changed are returned.
 */
function readClaudeCodeOverrides(filePath: string): KeybindingOverrides {
  const content = readOptionalFile(filePath);
  if (content === null) return {};
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.bindings)) return {};

  const profileBindings = getKeybindingProfile('claude-code').bindings;
  const chords = new Map<KeybindingAction, string[]>();
  const current = (action: KeybindingAction): string[] => {
    const existing = chords.get(action);
    if (existing) return existing;
    const seeded = [...(profileBindings[action] ?? defaultChordsFor(action))];
    chords.set(action, seeded);
    return seeded;
  };

  for (const block of parsed.bindings) {
    if (!isRecord(block) || !CLAUDE_CODE_CONTEXTS.has(String(block.context)) || !isRecord(block.bindings)) continue;
    for (const [keySpec, action] of Object.entries(block.bindings)) {
      if (!parseChord(keySpec)) continue;
      const normalized = normalizeSpec(keySpec);
      if (action === null) {
        for (const target of Object.values(CLAUDE_CODE_ACTION_MAP)) {
          const list = current(target);
          const index = list.findIndex((spec) => normalizeSpec(spec) === normalized);
          if (index !== -1) list.splice(index, 1);
        }
        continue;
      }
      const target = typeof action === 'string' ? CLAUDE_CODE_ACTION_MAP[action] : undefined;
      if (!target) continue;
      const list = current(target);
      if (!list.some((spec) => normalizeSpec(spec) === normalized)) list.push(keySpec);
    }
  }

  const overrides: KeybindingOverrides = {};
  for (const [action, list] of chords) {
    const original = profileBindings[action] ?? defaultChordsFor(action);
    if (list.length !== original.length || list.some((spec, index) => normalizeSpec(spec) !== normalizeSpec(original[index] ?? ''))) {
      overrides[action] = list;
    }
  }
  return overrides;
}

/** Codex keymaps state an action's complete binding list, so they replace. */
function readCodexOverrides(filePath: string): KeybindingOverrides {
  const content = readOptionalFile(filePath);
  if (content === null) return {};
  const parsed: unknown = parseToml(content);
  if (!isRecord(parsed) || !isRecord(parsed.tui) || !isRecord(parsed.tui.keymap)) return {};

  const overrides: KeybindingOverrides = {};
  for (const [id, action] of Object.entries(CODEX_ACTION_MAP)) {
    const [context, name] = id.split('.');
    const section = parsed.tui.keymap[context!];
    if (!isRecord(section) || !(name! in section)) continue;
    const value = section[name!];
    const specs = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : null;
    if (specs) overrides[action] = specs;
  }
  return overrides;
}

function defaultChordsFor(action: KeybindingAction): readonly string[] {
  return DEFAULT_BINDING_SPECS[action];
}

function normalizeSpec(spec: string): string {
  const chord = parseChord(spec);
  return chord ? normalizeChord(chord) : spec.trim().toLowerCase();
}
