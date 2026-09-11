/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keybinding profiles for the interactive composer.
 *
 * A profile maps the handful of composer actions that other coding agents
 * bind differently onto chords. Everything the ecosystem agrees on (Esc,
 * Ctrl+C, Enter, Tab, editing keys) stays fixed and is not represented here.
 */

export const KEYBINDING_ACTIONS = [
  'cycleMode',
  'newline',
  'exit',
  'toggleLiveOutput',
  'toggleTeamPanel',
  'toggleGoals',
  'openHistory',
  'toggleShortcutsHelp',
] as const;

export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number];

export const KEYBINDING_PROFILE_IDS = [
  'autohand',
  'claude-code',
  'codex',
  'cursor',
  'antigravity',
  'devin',
  'factory',
] as const;

export type KeybindingProfileId = (typeof KEYBINDING_PROFILE_IDS)[number];

export interface Chord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

/** A keypress normalised from an Ink key or a readline key. */
export interface KeyEvent {
  input: string;
  name?: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export type KeybindingOverrides = Partial<Record<KeybindingAction, string[]>>;

export interface KeybindingProfile {
  id: KeybindingProfileId;
  /** Shown in settings and onboarding, e.g. "Same as Claude Code". */
  label: string;
  /** The agent's own name, used when listing detected agents. */
  agentLabel?: string;
  /** Home-relative directories whose presence means the agent is installed. */
  homeDirectories: string[];
  /** Chords that replace the Autohand defaults for an action. */
  bindings: KeybindingOverrides;
}

export interface KeybindingHelpRow {
  left: string;
  right: string;
}

export interface ResolvedKeybindings {
  profile: KeybindingProfileId;
  bindings: Record<KeybindingAction, Chord[]>;
  matches(action: KeybindingAction, event: KeyEvent): boolean;
  /** Normalised chords ("ctrl+d") that extensions must not shadow. */
  reservedChords(): Set<string>;
  helpRows(): KeybindingHelpRow[];
}

const MODIFIER_ALIASES: Record<string, keyof Omit<Chord, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'meta',
  opt: 'meta',
  option: 'meta',
  meta: 'meta',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
};

const NAMED_KEYS = new Set(['enter', 'tab', 'escape', 'up', 'down', 'left', 'right', 'space', 'backspace', 'delete']);

export const DEFAULT_BINDING_SPECS: Readonly<Record<KeybindingAction, readonly string[]>> = {
  cycleMode: ['shift+tab'],
  newline: ['shift+enter', 'alt+enter'],
  exit: [],
  toggleLiveOutput: ['ctrl+o'],
  toggleTeamPanel: ['ctrl+t', 'meta+t'],
  toggleGoals: ['ctrl+g', 'meta+g'],
  openHistory: [],
  toggleShortcutsHelp: ['?'],
};

const NEWLINE_WITH_CTRL_J = [...DEFAULT_BINDING_SPECS.newline, 'ctrl+j'];

const PROFILES: Record<KeybindingProfileId, KeybindingProfile> = {
  autohand: {
    id: 'autohand',
    label: 'Autohand defaults',
    homeDirectories: ['.autohand'],
    bindings: {},
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Same as Claude Code',
    agentLabel: 'Claude Code',
    homeDirectories: ['.claude'],
    bindings: { newline: NEWLINE_WITH_CTRL_J, exit: ['ctrl+d'], openHistory: ['ctrl+r'] },
  },
  codex: {
    id: 'codex',
    label: 'Same as Codex',
    agentLabel: 'Codex',
    homeDirectories: ['.codex'],
    bindings: { newline: NEWLINE_WITH_CTRL_J, exit: ['ctrl+d'], openHistory: ['ctrl+r'] },
  },
  cursor: {
    id: 'cursor',
    label: 'Same as Cursor',
    agentLabel: 'Cursor',
    homeDirectories: ['.cursor'],
    bindings: { newline: NEWLINE_WITH_CTRL_J, exit: ['ctrl+d'] },
  },
  antigravity: {
    id: 'antigravity',
    label: 'Same as Antigravity',
    agentLabel: 'Antigravity',
    homeDirectories: ['.gemini/antigravity-cli'],
    bindings: { newline: NEWLINE_WITH_CTRL_J, exit: ['ctrl+d'] },
  },
  devin: {
    id: 'devin',
    label: 'Same as Devin',
    agentLabel: 'Devin',
    homeDirectories: ['.config/devin'],
    bindings: { newline: NEWLINE_WITH_CTRL_J, exit: ['ctrl+d'], openHistory: ['ctrl+r'] },
  },
  factory: {
    id: 'factory',
    label: 'Same as Factory Droid',
    agentLabel: 'Factory Droid',
    homeDirectories: ['.factory'],
    // Droid exits with Ctrl+C twice and only inserts newlines with Shift+Enter.
    bindings: {},
  },
};

const ACTION_HELP: Record<KeybindingAction, string> = {
  cycleMode: 'cycles interaction modes',
  newline: 'inserts newline',
  exit: 'exits',
  toggleLiveOutput: 'expands command output',
  toggleTeamPanel: 'toggles the team panel',
  toggleGoals: 'toggles the goals panel',
  openHistory: 'opens history',
  toggleShortcutsHelp: 'toggles this shortcuts panel',
};

export function isKeybindingProfileId(value: unknown): value is KeybindingProfileId {
  return typeof value === 'string' && (KEYBINDING_PROFILE_IDS as readonly string[]).includes(value);
}

export function getKeybindingProfile(id: KeybindingProfileId): KeybindingProfile {
  return PROFILES[id];
}

export function parseChord(spec: string): Chord | null {
  const trimmed = spec.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const parts = trimmed === '?' ? ['?'] : trimmed.split(/[+-]/);
  const key = parts.at(-1);
  if (!key) return null;
  const chord: Chord = { key: KEY_ALIASES[key] ?? key, ctrl: false, shift: false, meta: false };
  for (const modifier of parts.slice(0, -1)) {
    const field = MODIFIER_ALIASES[modifier];
    if (!field) return null;
    chord[field] = true;
  }
  return chord;
}

export function formatChord(chord: Chord): string {
  const label = chord.key === 'meta' ? 'alt' : chord.key;
  const parts = [chord.ctrl ? 'ctrl' : null, chord.meta ? 'alt' : null, chord.shift ? 'shift' : null, label];
  return parts.filter(Boolean).join(' + ');
}

export function normalizeChord(chord: Chord): string {
  return [chord.ctrl ? 'ctrl' : null, chord.meta ? 'meta' : null, chord.shift ? 'shift' : null, chord.key]
    .filter(Boolean)
    .join('+');
}

export function matchesChord(chord: Chord, event: KeyEvent): boolean {
  if (chord.key === '?') {
    return event.input === '?' && !event.ctrl && !event.meta;
  }
  // Ctrl+J has no modifier bits on a legacy terminal: it arrives as a bare line feed.
  if (chord.key === 'j' && chord.ctrl && !chord.shift && !chord.meta && event.input === '\n') {
    return true;
  }
  if (event.ctrl !== chord.ctrl || event.shift !== chord.shift || event.meta !== chord.meta) {
    return false;
  }
  if (NAMED_KEYS.has(chord.key)) {
    const name = event.name === 'return' ? 'enter' : event.name;
    if (name === chord.key) return true;
    return chord.key === 'enter' && event.input === '\r';
  }
  return event.input.toLowerCase() === chord.key;
}

function parseChords(specs: readonly string[]): Chord[] {
  return specs.map(parseChord).filter((chord): chord is Chord => chord !== null);
}

export function resolveKeybindings(
  profile: KeybindingProfileId = 'autohand',
  overrides: KeybindingOverrides = {},
): ResolvedKeybindings {
  const profileBindings = PROFILES[profile].bindings;
  const bindings = Object.fromEntries(
    KEYBINDING_ACTIONS.map((action) => [
      action,
      parseChords(overrides[action] ?? profileBindings[action] ?? DEFAULT_BINDING_SPECS[action]),
    ]),
  ) as Record<KeybindingAction, Chord[]>;

  return {
    profile,
    bindings,
    matches: (action, event) => bindings[action].some((chord) => matchesChord(chord, event)),
    reservedChords: () => new Set(Object.values(bindings).flat().map(normalizeChord)),
    helpRows: () => buildHelpRows(bindings),
  };
}

function describe(action: KeybindingAction, chords: Chord[]): string[] {
  return chords.map((chord) => `${formatChord(chord)} ${ACTION_HELP[action]}`);
}

/**
 * Two-column rows for the `?` panel. Fixed entries (slash, mention, shell,
 * Enter, Ctrl+C, Esc) sit next to the profile's active chords.
 */
function buildHelpRows(bindings: Record<KeybindingAction, Chord[]>): KeybindingHelpRow[] {
  const cells = [
    '/ for commands',
    '! for shell commands',
    '@ for file paths',
    'tab accepts suggestion',
    '$ for skills',
    ...describe('cycleMode', bindings.cycleMode),
    ...describe('newline', bindings.newline),
    'enter submits prompt',
    'ctrl + c clears input / exits',
    ...describe('exit', bindings.exit),
    '↑ / ↓ recalls typed messages',
    '/whatityped opens history',
    ...describe('openHistory', bindings.openHistory),
    ...describe('toggleLiveOutput', bindings.toggleLiveOutput.slice(0, 1)),
    ...describe('toggleShortcutsHelp', bindings.toggleShortcutsHelp.slice(0, 1)),
    'esc interrupts active turn',
    'type /, @, $, or ! to switch mode',
  ];
  const rows: KeybindingHelpRow[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push({ left: cells[index] ?? '', right: cells[index + 1] ?? '' });
  }
  return rows;
}

export const DEFAULT_KEYBINDINGS: ResolvedKeybindings = resolveKeybindings('autohand');
