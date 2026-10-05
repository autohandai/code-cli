/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { AXO_HELP_TEXT } from '../../../src/ui/axo/axoCommand.js';
import {
  AXO_CUE_MS,
  axoCueDurationMs,
  wrapAxoCaption,
  axoSleepDelayMs,
  classifyAxoTyping,
  resolveAxoLook,
  type AxoLookInput,
} from '../../../src/ui/axo/axoPose.js';
import { AXO_FRAMES } from '../../../src/ui/axo/axoSprites.js';

const calm: AxoLookInput = {
  cue: null,
  now: 10_000,
  working: false,
  failed: false,
  justFinished: false,
  asleep: false,
  typing: '',
};

describe('resolveAxoLook', () => {
  it('idles, and reads the prompt being typed', () => {
    expect(resolveAxoLook(calm).sprite).toBe('idle');
    expect(resolveAxoLook({ ...calm, typing: 'refactor the parser' }).sprite).toBe('look');
    expect(resolveAxoLook({ ...calm, typing: 'why is this slow?' })).toMatchObject({ sprite: 'curious', caption: '?' });
    expect(resolveAxoLook({ ...calm, typing: 'thanks axo' }).sprite).toBe('happy');
    expect(resolveAxoLook({ ...calm, typing: 'the build is BROKEN' }).sprite).toBe('surprised');
  });

  it('runs while the agent works, cries after a failure, and jumps after a clean finish', () => {
    expect(resolveAxoLook({ ...calm, working: true, typing: 'thanks' }).sprite).toBe('run');
    expect(resolveAxoLook({ ...calm, failed: true })).toMatchObject({ sprite: 'cry', caption: 'oh no…' });
    expect(resolveAxoLook({ ...calm, justFinished: true }).sprite).toBe('jump');
  });

  it('puts the agent ahead of sleep, and a fresh command ahead of everything', () => {
    expect(resolveAxoLook({ ...calm, asleep: true }).sprite).toBe('sleep');
    expect(resolveAxoLook({ ...calm, asleep: true, working: true }).sprite).toBe('run');
    const feed = { kind: 'feed' as const, id: 1, at: 9_000 };
    expect(resolveAxoLook({ ...calm, working: true, cue: feed })).toMatchObject({ sprite: 'happy', caption: 'nom nom ♥' });
  });

  it('lets a cue expire after its time', () => {
    const cue = { kind: 'pet' as const, id: 1, at: 0 };
    expect(resolveAxoLook({ ...calm, cue, now: AXO_CUE_MS.pet - 1 }).sprite).toBe('happy');
    expect(resolveAxoLook({ ...calm, cue, now: AXO_CUE_MS.pet }).sprite).toBe('idle');
  });

  it('shows messages, help, and the goodbye swim', () => {
    const say = { kind: 'say' as const, id: 1, at: 9_500, text: 'you did great' };
    expect(resolveAxoLook({ ...calm, cue: say })).toMatchObject({ sprite: 'happy', caption: 'you did great' });
    expect(resolveAxoLook({ ...calm, cue: { kind: 'help', id: 1, at: 9_500 } }).caption).toBe(AXO_HELP_TEXT);
    expect(resolveAxoLook({ ...calm, cue: { kind: 'home', id: 1, at: 9_500 } }).sprite).toBe('swim');
  });

  it('only uses sprites that exist', () => {
    const cues = Object.keys(AXO_CUE_MS) as (keyof typeof AXO_CUE_MS)[];
    for (const kind of cues) {
      const look = resolveAxoLook({ ...calm, cue: { kind, id: 1, at: 9_900, text: 'hi' } });
      expect(AXO_FRAMES[look.sprite].length).toBeGreaterThan(0);
    }
  });
});

describe('classifyAxoTyping', () => {
  it('ignores whitespace and treats a trailing bang as alarm', () => {
    expect(classifyAxoTyping('   ')).toBe('none');
    expect(classifyAxoTyping('deploy now!')).toBe('surprised');
  });
});

describe('axoSleepDelayMs', () => {
  it('naps after a minute, half that late at night', () => {
    expect(axoSleepDelayMs(new Date(2026, 9, 5, 14))).toBe(60_000);
    expect(axoSleepDelayMs(new Date(2026, 9, 5, 23, 30))).toBe(30_000);
    expect(axoSleepDelayMs(new Date(2026, 9, 6, 4))).toBe(30_000);
  });
});

describe('answers', () => {
  it('thinks while waiting, then shows the answer long enough to read', () => {
    expect(resolveAxoLook({ ...calm, cue: { kind: 'think', id: 1, at: 9_000, text: 'why?' } })).toMatchObject({
      sprite: 'curious',
      caption: '…',
    });
    const answer = { kind: 'answer' as const, id: 2, at: 9_000, text: 'Because tests love you!' };
    expect(resolveAxoLook({ ...calm, cue: answer })).toMatchObject({ sprite: 'happy', caption: 'Because tests love you!' });
    expect(axoCueDurationMs(answer)).toBeGreaterThan(AXO_CUE_MS.answer);
    expect(axoCueDurationMs({ ...answer, text: 'x'.repeat(1_000) })).toBe(12_000);
  });
});

describe('wrapAxoCaption', () => {
  it('wraps on words within the width', () => {
    expect(wrapAxoCaption('one two three four five', 9, 5)).toEqual(['one two', 'three', 'four five']);
  });

  it('stops at the line limit with an ellipsis, and splits overlong words', () => {
    expect(wrapAxoCaption('aa bb cc dd ee', 2, 2)).toEqual(['aa', 'b…']);
    expect(wrapAxoCaption('supercalifragilistic', 6, 3)).toEqual(['super…']);
    expect(wrapAxoCaption('   ', 10, 3)).toEqual([]);
  });
});
