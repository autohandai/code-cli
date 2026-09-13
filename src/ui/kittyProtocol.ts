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
 * Flag 1 only: modified keys that have no legacy encoding (Shift+Enter,
 * Alt+key, Esc) arrive as CSI u while plain keys and Ctrl+letters keep their
 * legacy bytes. Terminals without the protocol ignore the request.
 */
export const KITTY_DISAMBIGUATE_FLAG = 1;

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
