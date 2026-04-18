/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kitty Keyboard Protocol support for advanced keyboard features.
 *
 * The Kitty keyboard protocol provides:
 * - Unambiguous key identifiers (no more guessing what a key press means)
 * - Key release and repeat events
 * - Alternate keys (shifted key, base layout key) for non-Latin keyboards
 * - Modifier state for all keys
 *
 * Reference: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 */

/** Global state for Kitty protocol active status */
let kittyProtocolActive = false;

/** Global state for modifyOtherKeys mode (fallback for tmux) */
let modifyOtherKeysActive = false;

/**
 * Check if Kitty keyboard protocol is currently active.
 */
export function isKittyProtocolActive(): boolean {
  return kittyProtocolActive;
}

/**
 * Check if modifyOtherKeys mode is currently active.
 */
export function isModifyOtherKeysActive(): boolean {
  return modifyOtherKeysActive;
}

/**
 * Set the Kitty protocol active state (called by Terminal when response detected).
 */
export function setKittyProtocolActive(active: boolean): void {
  kittyProtocolActive = active;
}

/**
 * Set the modifyOtherKeys active state.
 */
export function setModifyOtherKeysActive(active: boolean): void {
  modifyOtherKeysActive = active;
}

/**
 * Query terminal for Kitty keyboard protocol support.
 *
 * Sends CSI ? u to query current flags. If terminal responds with
 * CSI ? <flags> u, it supports the protocol.
 *
 * The response should be detected by the StdinBuffer's data handler.
 */
export function queryKittyProtocol(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[?u');
}

/**
 * Enable Kitty keyboard protocol with specified flags.
 *
 * Flags (bitmask):
 * - 1: Disambiguate escape codes (makes Escape key distinguishable from escape sequences)
 * - 2: Report event types (press/repeat/release)
 * - 4: Report alternate keys (shifted key, base layout key)
 * - 8: Report all keys as escape codes (even plain keys)
 * - 16: Report associated text
 *
 * We use flags 1+2+4 = 7 for:
 * - Disambiguate escape codes
 * - Report event types (for key release detection)
 * - Report alternate keys (for non-Latin keyboard support)
 */
export function enableKittyProtocol(stdout: NodeJS.WriteStream, flags = 7): void {
  stdout.write(`\x1b[>${flags}u`);
  kittyProtocolActive = true;
}

/**
 * Disable Kitty keyboard protocol.
 *
 * Should be called before exiting to prevent key release events
 * from leaking to the parent shell.
 */
export function disableKittyProtocol(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[<u');
  kittyProtocolActive = false;
}

/**
 * Enable xterm modifyOtherKeys mode 2.
 *
 * This is a fallback for terminals that don't support Kitty protocol
 * but do support the xterm modifyOtherKeys extension. This is needed
 * for tmux, which can forward modified enter keys as CSI-u when
 * extended-keys is enabled.
 *
 * Mode 2: Report modified keys as CSI sequences
 */
export function enableModifyOtherKeys(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[>4;2m');
  modifyOtherKeysActive = true;
}

/**
 * Disable xterm modifyOtherKeys mode.
 */
export function disableModifyOtherKeys(stdout: NodeJS.WriteStream): void {
  stdout.write('\x1b[>4;0m');
  modifyOtherKeysActive = false;
}

/**
 * Regex matching Kitty protocol response: CSI ? <flags> u
 */
export const KITTY_RESPONSE_PATTERN = /^\x1b\[\?(\d+)u$/;

/**
 * Check if a sequence is a Kitty protocol response.
 * Returns the flags if matched, null otherwise.
 */
export function parseKittyResponse(sequence: string): number | null {
  const match = sequence.match(KITTY_RESPONSE_PATTERN);
  if (match) {
    return parseInt(match[1]!, 10);
  }
  return null;
}

/**
 * Kitty key event parsed from escape sequence.
 *
 * Format: CSI <key> ; <modifiers> : <event_type> u
 * or simplified: CSI <key> ; <modifiers> u
 */
export interface KittyKeyEvent {
  /** Key code (Unicode code point or Kitty key ID) */
  key: number;
  /** Modifier bitmask: 1=Shift, 2=Alt, 4=Ctrl, 8=Super */
  modifiers: number;
  /** Event type: 1=press, 2=repeat, 3=release */
  eventType?: number;
  /** Shifted key (if flag 4 enabled and key has shifted form) */
  shiftedKey?: number;
  /** Base layout key (if flag 4 enabled) */
  baseLayoutKey?: number;
}

/**
 * Parse a Kitty key event from an escape sequence.
 *
 * Format examples:
 * - CSI 97 ; 1 u = 'a' with Shift
 * - CSI 97 ; 1 : 1 u = 'a' with Shift, press event
 * - CSI 97 ; 1 : 3 u = 'A' with Shift, release event
 */
export function parseKittyKeyEvent(sequence: string): KittyKeyEvent | null {
  // Match CSI <key> ; <modifiers> [ : <event_type> ] [ : <shifted> ] [ : <base> ] u
  const match = sequence.match(/^\x1b\[(\d+);(\d+)(?::(\d+))?(?::(\d+))?(?::(\d+))?u$/);
  if (!match) {
    return null;
  }

  const [, keyStr, modStr, eventStr, shiftedStr, baseStr] = match;

  return {
    key: parseInt(keyStr!, 10),
    modifiers: parseInt(modStr!, 10),
    eventType: eventStr ? parseInt(eventStr, 10) : undefined,
    shiftedKey: shiftedStr ? parseInt(shiftedStr, 10) : undefined,
    baseLayoutKey: baseStr ? parseInt(baseStr, 10) : undefined,
  };
}

/**
 * Modifier bit masks for Kitty key events.
 */
export const KITTY_MODIFIERS = {
  SHIFT: 1,
  ALT: 2,
  CTRL: 4,
  SUPER: 8,
  HYPER: 16,
  META: 32,
} as const;

/**
 * Kitty event types.
 */
export const KITTY_EVENT_TYPES = {
  PRESS: 1,
  REPEAT: 2,
  RELEASE: 3,
} as const;

/**
 * Special Kitty key codes (not Unicode code points).
 */
export const KITTY_SPECIAL_KEYS = {
  ENTER: 57350,
  TAB: 57351,
  BACKSPACE: 57352,
  ESCAPE: 57353,
  INSERT: 57354,
  DELETE: 57355,
  LEFT: 57356,
  RIGHT: 57357,
  UP: 57358,
  DOWN: 57359,
  PAGE_UP: 57360,
  PAGE_DOWN: 57361,
  HOME: 57362,
  END: 57363,
  CAPS_LOCK: 57364,
  SCROLL_LOCK: 57365,
  NUM_LOCK: 57366,
  PRINT_SCREEN: 57367,
  PAUSE: 57368,
  MENU: 57369,
  F1: 57370,
  F2: 57371,
  F3: 57372,
  F4: 57373,
  F5: 57374,
  F6: 57375,
  F7: 57376,
  F8: 57377,
  F9: 57378,
  F10: 57379,
  F11: 57380,
  F12: 57381,
} as const;

/**
 * Check if a Kitty key event is a key release.
 */
export function isKeyRelease(event: KittyKeyEvent): boolean {
  return event.eventType === KITTY_EVENT_TYPES.RELEASE;
}

/**
 * Check if a Kitty key event is a key press.
 */
export function isKeyPress(event: KittyKeyEvent): boolean {
  return event.eventType === KITTY_EVENT_TYPES.PRESS || event.eventType === undefined;
}

/**
 * Check if Shift is held in a Kitty key event.
 */
export function hasShift(event: KittyKeyEvent): boolean {
  return (event.modifiers & KITTY_MODIFIERS.SHIFT) !== 0;
}

/**
 * Check if Alt is held in a Kitty key event.
 */
export function hasAlt(event: KittyKeyEvent): boolean {
  return (event.modifiers & KITTY_MODIFIERS.ALT) !== 0;
}

/**
 * Check if Ctrl is held in a Kitty key event.
 */
export function hasCtrl(event: KittyKeyEvent): boolean {
  return (event.modifiers & KITTY_MODIFIERS.CTRL) !== 0;
}