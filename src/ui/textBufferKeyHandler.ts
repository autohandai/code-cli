/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextBuffer } from './textBuffer.js';

/**
 * Result of processing a keypress through the text buffer key handler.
 *
 * - `'handled'`   – The keypress was consumed and applied to the buffer.
 * - `'submit'`    – The user pressed Enter (unmodified) to submit the input.
 * - `'unhandled'` – The keypress was not recognized; the caller should handle it
 *                   (e.g., Escape, Ctrl+C, Tab, function keys).
 */
export type KeyHandlerResult = 'handled' | 'submit' | 'unhandled';

/** Readline-compatible key descriptor. */
interface KeyInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

/**
 * Regex matching non-printable control characters.
 * Characters in the range U+0000..U+001F and U+007F are control chars.
 * We use this to decide whether `str` contains printable text worth inserting.
 */
const CONTROL_CHAR_RE = /^[\x00-\x1f\x7f]/;

/**
 * Regex matching CSI escape sequence residuals for modified Enter keys.
 * When a terminal sends e.g. ESC[13;2~ for Shift+Enter, readline may consume
 * the ESC[ prefix and pass the remainder ("13;2~", "13~", "13;2u", etc.) as
 * literal text. We must NOT insert these as printable input.
 */
const CSI_ENTER_RESIDUAL_RE = /^(?:13;?[234]?\d*[u~]|27;[234];13~)$/;

/**
 * Maps a readline keypress event to a {@link TextBuffer} mutation.
 *
 * The function interprets the raw `str` and parsed `key` info from Node's
 * readline keypress events and translates them into the appropriate
 * TextBuffer method call. It returns a {@link KeyHandlerResult} so the
 * caller knows whether the key was consumed, triggers submission, or
 * should be handled elsewhere.
 *
 * Key mapping:
 *
 * | Input                      | Action                   | Result      |
 * |----------------------------|--------------------------|-------------|
 * | Backspace                  | `buffer.backspace()`     | `handled`   |
 * | Delete                     | `buffer.delete()`        | `handled`   |
 * | Left                       | `buffer.moveLeft()`      | `handled`   |
 * | Right                      | `buffer.moveRight()`     | `handled`   |
 * | Up                         | `buffer.moveUp()`        | `handled`   |
 * | Down                       | `buffer.moveDown()`      | `handled`   |
 * | Home / Ctrl+A              | `buffer.moveHome()`      | `handled`   |
 * | End / Ctrl+E               | `buffer.moveEnd()`       | `handled`   |
 * | Ctrl+Left / Alt+Left       | `buffer.moveWordLeft()`  | `handled`   |
 * | Ctrl+Right / Alt+Right     | `buffer.moveWordRight()` | `handled`   |
 * | Shift+Enter / Alt+Enter    | `buffer.insert('\n')`    | `handled`   |
 * | Enter (no modifier)        | (no mutation)            | `submit`    |
 * | Printable text             | `buffer.insert(str)`     | `handled`   |
 * | Everything else            | (no mutation)            | `unhandled` |
 */
export function handleTextBufferKey(
  buffer: TextBuffer,
  str: string,
  key: KeyInfo,
): KeyHandlerResult {
  const name = key.name;
  const ctrl = key.ctrl === true;
  const meta = key.meta === true;
  const shift = key.shift === true;

  // ── Enter ────────────────────────────────────────────────────────────
  // Shift+Enter or Alt+Enter inserts a newline; plain Enter submits.
  if (name === 'return') {
    if (shift || meta) {
      buffer.insert('\n');
      return 'handled';
    }
    return 'submit';
  }

  // ── Backspace / Delete ───────────────────────────────────────────────
  if (name === 'backspace') {
    buffer.backspace();
    return 'handled';
  }
  if (name === 'delete') {
    buffer.delete();
    return 'handled';
  }

  // ── Arrow keys with modifier → word navigation ──────────────────────
  if (name === 'left' && (ctrl || meta)) {
    buffer.moveWordLeft();
    return 'handled';
  }
  if (name === 'right' && (ctrl || meta)) {
    buffer.moveWordRight();
    return 'handled';
  }

  // ── Plain arrow keys ────────────────────────────────────────────────
  if (name === 'left') {
    buffer.moveLeft();
    return 'handled';
  }
  if (name === 'right') {
    buffer.moveRight();
    return 'handled';
  }
  if (name === 'up') {
    buffer.moveUp();
    return 'handled';
  }
  if (name === 'down') {
    buffer.moveDown();
    return 'handled';
  }

  // ── Home / End ──────────────────────────────────────────────────────
  if (name === 'home') {
    buffer.moveHome();
    return 'handled';
  }
  if (name === 'end') {
    buffer.moveEnd();
    return 'handled';
  }

  // ── Ctrl+A (Home) / Ctrl+E (End) ───────────────────────────────────
  if (ctrl && name === 'a') {
    buffer.moveHome();
    return 'handled';
  }
  if (ctrl && name === 'e') {
    buffer.moveEnd();
    return 'handled';
  }

  // ── Printable text ──────────────────────────────────────────────────
  // Insert if `str` is non-empty and does not start with a control char.
  // Ctrl/Meta combos that reach here are intentionally skipped (they fall
  // through to 'unhandled' below) because their `str` is either empty or
  // starts with a control byte.
  // Also reject CSI residual fragments (e.g. "13~", "13;2u") that leak
  // through when readline consumes the ESC[ prefix of a modified-Enter
  // sequence but passes the tail as literal text.
  if (str && !CONTROL_CHAR_RE.test(str) && !CSI_ENTER_RESIDUAL_RE.test(str)) {
    buffer.insert(str);
    return 'handled';
  }

  // ── Everything else ─────────────────────────────────────────────────
  return 'unhandled';
}
