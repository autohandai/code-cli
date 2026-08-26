/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scroll arithmetic for the /peers screen. Pure and free of Ink so the
 * windowing can be tested directly.
 *
 * The screen always emits exactly `height` rows, padding short windows with
 * blanks. A constant frame size is what keeps the alternate screen from
 * flickering: Ink rewrites the same rectangle every frame instead of erasing a
 * taller frame and redrawing a shorter one.
 */

export interface PeersScrollWindow {
  /** Exactly `height` entries; short content is padded with empty strings. */
  lines: string[];
  /** First visible line index, after clamping. */
  offset: number;
  atTop: boolean;
  atBottom: boolean;
  /** True when the content is taller than the viewport. */
  scrollable: boolean;
  totalLines: number;
}

export function maxScrollOffset(totalLines: number, height: number): number {
  return Math.max(0, totalLines - Math.max(1, height));
}

export function clampScrollOffset(offset: number, totalLines: number, height: number): number {
  const max = maxScrollOffset(totalLines, height);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.trunc(offset)), max);
}

export function windowPeerLines(
  lines: string[],
  offset: number,
  height: number,
): PeersScrollWindow {
  const safeHeight = Math.max(1, Math.trunc(height));
  const clamped = clampScrollOffset(offset, lines.length, safeHeight);
  const visible = lines.slice(clamped, clamped + safeHeight);

  while (visible.length < safeHeight) {
    visible.push('');
  }

  return {
    lines: visible,
    offset: clamped,
    atTop: clamped === 0,
    atBottom: clamped >= maxScrollOffset(lines.length, safeHeight),
    scrollable: lines.length > safeHeight,
    totalLines: lines.length,
  };
}

export type PeersScrollAction =
  | 'up'
  | 'down'
  | 'pageUp'
  | 'pageDown'
  | 'top'
  | 'bottom';

export function applyPeersScroll(
  action: PeersScrollAction,
  offset: number,
  totalLines: number,
  height: number,
): number {
  const safeHeight = Math.max(1, Math.trunc(height));
  // A page keeps one line of context so the reader can stitch the two screens
  // together rather than losing their place.
  const page = Math.max(1, safeHeight - 1);

  switch (action) {
    case 'up':
      return clampScrollOffset(offset - 1, totalLines, safeHeight);
    case 'down':
      return clampScrollOffset(offset + 1, totalLines, safeHeight);
    case 'pageUp':
      return clampScrollOffset(offset - page, totalLines, safeHeight);
    case 'pageDown':
      return clampScrollOffset(offset + page, totalLines, safeHeight);
    case 'top':
      return 0;
    case 'bottom':
      return maxScrollOffset(totalLines, safeHeight);
  }
}

/** "14-31 of 92" — omitted entirely when everything already fits. */
export function formatScrollPosition(window: PeersScrollWindow): string | null {
  if (!window.scrollable) return null;
  const first = window.offset + 1;
  const last = Math.min(window.totalLines, window.offset + window.lines.length);
  return `${first}-${last} of ${window.totalLines}`;
}
