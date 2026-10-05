/**
 * Axo, Autohand's axolotl, sitting just above the composer once `~axo` is typed.
 *
 * A memoized leaf that owns its own frame timer, so animation never re-renders the
 * rest of the bottom region. It follows the session (running turns, failures,
 * finishes, typing, idleness) from primitive props only.
 */

import React, { memo, useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { AXO_CUE_MS, AXO_FINISH_MS, axoSleepDelayMs, resolveAxoLook, wrapAxoCaption } from './axoPose.js';
import { canRenderAxo, renderAxoRows } from './axoRender.js';
import type { AxoUIState } from './axoState.js';
import { AXO_FRAMES, AXO_SPRITE_PIXEL_HEIGHT, AXO_SPRITE_WIDTH } from './axoSprites.js';

/** Terminal rows Axo occupies. */
export const AXO_ROWS = AXO_SPRITE_PIXEL_HEIGHT / 2;
/** Below these sizes Axo stays out of the way. */
export const AXO_MIN_COLUMNS = 72;
export const AXO_MIN_ROWS = 26;
const IDLE_TICK_MS = 1_000;

export function shouldShowAxo(enabled: boolean, columns: number, rows: number | undefined): boolean {
  return enabled && columns >= AXO_MIN_COLUMNS && (rows === undefined || rows >= AXO_MIN_ROWS);
}

function prefersReducedMotion(): boolean {
  return process.env.AUTOHAND_REDUCED_MOTION === '1';
}

export interface AxoBuddyProps {
  readonly axo: AxoUIState;
  readonly isWorking: boolean;
  /** How the most recent turn ended. */
  readonly turnStatus: 'completed' | 'failed' | undefined;
  readonly input: string;
  readonly columns: number;
  readonly rows: number | undefined;
  /** Axo finished saying goodbye after `~axo home`. */
  readonly onGone: () => void;
}

export const AxoBuddy = memo(function AxoBuddy({
  axo,
  isWorking,
  turnStatus,
  input,
  columns,
  rows,
  onGone,
}: AxoBuddyProps) {
  const { theme } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [asleep, setAsleep] = useState(false);
  const lastActivityAtRef = useRef(Date.now());
  const previousWorkingRef = useRef(isWorking);
  const handledCueIdRef = useRef(axo.cue?.id ?? 0);
  const goneCueIdRef = useRef<number | null>(null);

  // Turn edges: a failed turn makes Axo cry, a clean one earns a little jump.
  useEffect(() => {
    const wasWorking = previousWorkingRef.current;
    previousWorkingRef.current = isWorking;
    lastActivityAtRef.current = Date.now();
    setAsleep(false);
    if (isWorking && !wasWorking) {
      setFailed(false);
      setFinishedAt(null);
    } else if (!isWorking && wasWorking) {
      if (turnStatus === 'failed') setFailed(true);
      else setFinishedAt(Date.now());
    }
  }, [isWorking, turnStatus]);

  // Typing wakes Axo up.
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    setAsleep(false);
  }, [input]);

  // Commands: a pet or a snack consoles a crying Axo; sleep and wake do what they say.
  const cue = axo.cue;
  useEffect(() => {
    if (!cue || cue.id === handledCueIdRef.current) return;
    handledCueIdRef.current = cue.id;
    lastActivityAtRef.current = Date.now();
    setNow(Date.now());
    if (cue.kind === 'pet' || cue.kind === 'feed') setFailed(false);
    setAsleep(cue.kind === 'sleep');
  }, [cue]);

  const look = resolveAxoLook({
    cue,
    now,
    working: isWorking,
    failed,
    justFinished: finishedAt !== null && now - finishedAt < AXO_FINISH_MS,
    asleep,
    typing: input,
  });
  const reducedMotion = prefersReducedMotion();
  const fps = reducedMotion ? 0 : look.fps;

  // One timer drives frames, cue expiry, the finish celebration, and dozing off.
  useEffect(() => {
    const timer = setInterval(
      () => {
        const current = Date.now();
        setNow(current);
        if (!isWorking && current - lastActivityAtRef.current >= axoSleepDelayMs(new Date(current))) {
          setAsleep(true);
        }
      },
      fps > 0 ? Math.round(1000 / fps) : IDLE_TICK_MS,
    );
    return () => clearInterval(timer);
  }, [fps, isWorking]);

  // After the goodbye plays, Axo goes home for good.
  useEffect(() => {
    if (cue?.kind !== 'home' || goneCueIdRef.current === cue.id) return;
    if (now - cue.at < AXO_CUE_MS.home) return;
    goneCueIdRef.current = cue.id;
    onGone();
  }, [cue, now, onGone]);

  const colorMode = theme.getColorMode();
  if (!shouldShowAxo(axo.enabled, columns, rows) || !canRenderAxo(colorMode)) return null;

  const frames = AXO_FRAMES[look.sprite];
  const frame = frames[fps > 0 ? Math.floor((now / 1000) * fps) % frames.length : 0] ?? frames[0]!;
  const spriteRows = renderAxoRows(frame, { colorMode, mirror: true });
  // Answers wrap into a small column beside Axo, centred on its face.
  const captionWidth = Math.max(12, Math.min(44, columns - AXO_SPRITE_WIDTH - 8));
  const captionLines = look.caption ? wrapAxoCaption(look.caption, captionWidth, AXO_ROWS - 1) : [];
  const firstCaptionRow = Math.max(0, Math.floor((AXO_ROWS - captionLines.length) / 2) - 1);
  const captionAt = (row: number): string => {
    const line = captionLines[row - firstCaptionRow];
    if (line === undefined) return ' ';
    const pointer = row - firstCaptionRow === captionLines.length - 1 ? ' ◂' : '  ';
    return theme.fg('muted', `${line}${pointer}`);
  };

  return (
    <Box flexDirection="row" justifyContent="flex-end" height={AXO_ROWS}>
      <Box flexDirection="column" marginRight={1} alignItems="flex-end">
        {spriteRows.map((_, index) => (
          <Text key={index}>{captionAt(index)}</Text>
        ))}
      </Box>
      <Box flexDirection="column" width={AXO_SPRITE_WIDTH} flexShrink={0}>
        {spriteRows.map((row, index) => (
          <Text key={index}>{row}</Text>
        ))}
      </Box>
    </Box>
  );
});
