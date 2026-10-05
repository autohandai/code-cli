/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { applyAxoCommand, AXO_AWAY, sendAxoHome } from '../../../src/ui/axo/axoState.js';

describe('Axo state', () => {
  it('comes out for any command and greets on a bare summon', () => {
    const out = applyAxoCommand(AXO_AWAY, { kind: 'summon' }, 1_000);
    expect(out).toEqual({ enabled: true, cue: { kind: 'hello', id: 1, at: 1_000 } });
    const fed = applyAxoCommand(AXO_AWAY, { kind: 'feed' }, 2_000);
    expect(fed.enabled).toBe(true);
    expect(fed.cue?.kind).toBe('feed');
  });

  it('numbers cues so a repeated command replays', () => {
    const once = applyAxoCommand(AXO_AWAY, { kind: 'pet' }, 1);
    const twice = applyAxoCommand(once, { kind: 'pet' }, 2);
    expect(twice.cue?.id).toBe(2);
  });

  it('says goodbye before leaving, and ignores home while away', () => {
    expect(applyAxoCommand(AXO_AWAY, { kind: 'home' }, 1)).toBe(AXO_AWAY);
    const out = applyAxoCommand(AXO_AWAY, { kind: 'summon' }, 1);
    const leaving = applyAxoCommand(out, { kind: 'home' }, 2);
    expect(leaving).toMatchObject({ enabled: true, cue: { kind: 'home' } });
    expect(sendAxoHome()).toEqual(AXO_AWAY);
  });

  it('carries the message for say', () => {
    const out = applyAxoCommand(AXO_AWAY, { kind: 'say', text: 'hello' }, 1);
    expect(out.cue).toMatchObject({ kind: 'say', text: 'hello' });
  });
});
