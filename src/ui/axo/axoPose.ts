/**
 * What Axo looks like right now: a sprite, its frame rate, and a short caption.
 * Pure, so every mood transition is unit-testable without rendering.
 */

import { AXO_HELP_TEXT } from './axoCommand.js';
import type { AxoCue, AxoCueKind } from './axoState.js';
import type { AxoSpriteName } from './axoSprites.js';

export interface AxoLook {
  readonly sprite: AxoSpriteName;
  /** Frames per second; 0 holds the first frame. */
  readonly fps: number;
  readonly caption: string;
}

/** How long each cue plays before Axo goes back to following the session. */
export const AXO_CUE_MS: Readonly<Record<AxoCueKind, number>> = {
  hello: 2_600,
  feed: 2_200,
  pet: 1_600,
  dance: 2_800,
  sleep: 1_200,
  wake: 1_200,
  say: 4_500,
  help: 6_000,
  home: 1_600,
  // Replaced by the answer as soon as it lands; the timeout only bounds a hung call.
  think: 20_000,
  answer: 4_000,
};

/** Answers stay up long enough to read: a base, plus a little per character. */
export function axoCueDurationMs(cue: AxoCue): number {
  if (cue.kind !== 'answer') return AXO_CUE_MS[cue.kind];
  return Math.min(12_000, AXO_CUE_MS.answer + (cue.text?.length ?? 0) * 55);
}

/** What Axo says when no model answers (offline, signed out, or a failed call). */
export const AXO_NO_ANSWER = "hmm, my brain's offline right now ~";

/** A finished turn earns a short celebration. */
export const AXO_FINISH_MS = 2_000;

export function isAxoCueActive(cue: AxoCue | null, now: number): cue is AxoCue {
  return cue !== null && now - cue.at < axoCueDurationMs(cue);
}

export type AxoTypingMood = 'none' | 'watching' | 'curious' | 'surprised' | 'happy';

const HAPPY_PATTERN =
  /\b(axo|thanks?|thank you|thx|ty|love|lovely|great|awesome|amazing|nice|cool|yay|woo+|perfect|good (job|work)|well done|cute)\b|<3/iu;
const ALARM_PATTERN =
  /\b(bug|bugs|error|errors|broken|crash(es|ed)?|fail(s|ed|ing)?|wtf|ugh|oops|urgent|asap|panic|exception)\b|!\s*$/iu;
const SHOUT_PATTERN = /\b[A-Z]{4,}\b/u;

/** Same reading of the prompt as the desktop Axo, so both behave alike. */
export function classifyAxoTyping(text: string): AxoTypingMood {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'none';
  if (HAPPY_PATTERN.test(trimmed)) return 'happy';
  if (ALARM_PATTERN.test(trimmed) || SHOUT_PATTERN.test(trimmed)) return 'surprised';
  if (trimmed.endsWith('?')) return 'curious';
  return 'watching';
}

export interface AxoLookInput {
  readonly cue: AxoCue | null;
  readonly now: number;
  /** The agent is running a turn. */
  readonly working: boolean;
  /** The last turn failed and Axo has not been consoled since. */
  readonly failed: boolean;
  /** A turn finished cleanly within {@link AXO_FINISH_MS}. */
  readonly justFinished: boolean;
  readonly asleep: boolean;
  /** Composer text, for typing reactions. */
  readonly typing: string;
}

/**
 * Breaks a caption into at most `maxLines` lines of `width` columns, on word
 * boundaries, ending with an ellipsis if it had to stop early.
 */
export function wrapAxoCaption(text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const piece = word.length > width ? `${word.slice(0, width - 1)}…` : word;
    if (!line) line = piece;
    else if (line.length + 1 + piece.length <= width) line += ` ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = last.length >= width ? `${last.slice(0, width - 1)}…` : `${last}…`;
  return kept;
}

function typingLook(mood: AxoTypingMood): AxoLook {
  switch (mood) {
    case 'happy':
      return { sprite: 'happy', fps: 0, caption: '♥' };
    case 'surprised':
      return { sprite: 'surprised', fps: 0, caption: '!' };
    case 'curious':
      return { sprite: 'curious', fps: 0, caption: '?' };
    case 'watching':
      return { sprite: 'look', fps: 2, caption: '' };
    case 'none':
      return { sprite: 'idle', fps: 2, caption: '' };
  }
}

function cueLook(cue: AxoCue): AxoLook {
  switch (cue.kind) {
    case 'hello':
      return { sprite: 'happy', fps: 0, caption: "hi! I'm Axo" };
    case 'feed':
      return { sprite: 'happy', fps: 0, caption: 'nom nom ♥' };
    case 'pet':
      return { sprite: 'happy', fps: 0, caption: '♥ ♥' };
    case 'dance':
      return { sprite: 'jump', fps: 8, caption: '♪ ♫ ♪' };
    case 'sleep':
      return { sprite: 'sleep', fps: 0, caption: 'z Z' };
    case 'wake':
      return { sprite: 'surprised', fps: 0, caption: '!' };
    case 'say':
    case 'answer': {
      const text = cue.text ?? '';
      return { ...typingLook(classifyAxoTyping(text)), caption: text.replace(/\s+/g, ' ').trim() };
    }
    case 'think':
      return { sprite: 'curious', fps: 0, caption: '…' };
    case 'help':
      return { sprite: 'curious', fps: 0, caption: AXO_HELP_TEXT };
    case 'home':
      return { sprite: 'swim', fps: 9, caption: 'bye! ~' };
  }
}

/**
 * Highest priority wins: what the user just asked, then the agent (running, failing,
 * finishing), then sleep, then the prompt being typed, then idling.
 */
export function resolveAxoLook(input: AxoLookInput): AxoLook {
  if (isAxoCueActive(input.cue, input.now)) return cueLook(input.cue);
  if (input.working) return { sprite: 'run', fps: 8, caption: '' };
  if (input.failed) return { sprite: 'cry', fps: 3, caption: 'oh no…' };
  if (input.justFinished) return { sprite: 'jump', fps: 8, caption: 'done!' };
  if (input.asleep) return { sprite: 'sleep', fps: 0, caption: 'z Z' };
  return typingLook(classifyAxoTyping(input.typing));
}

/** Nap delay: a minute, halved late at night (11 pm – 5 am). */
export function axoSleepDelayMs(now: Date): number {
  const hour = now.getHours();
  return hour >= 23 || hour < 5 ? 30_000 : 60_000;
}
