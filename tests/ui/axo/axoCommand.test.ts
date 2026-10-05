/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isAxoInput, parseAxoInput } from '../../../src/ui/axo/axoCommand.js';

describe('~axo input', () => {
  it.each([
    ['~axo', { kind: 'summon' }],
    ['  ~AXO  ', { kind: 'summon' }],
    ['~axo feed', { kind: 'feed' }],
    ['~axo snack', { kind: 'feed' }],
    ['~axo pet', { kind: 'pet' }],
    ['~axo party', { kind: 'dance' }],
    ['~axo nap', { kind: 'sleep' }],
    ['~axo wake', { kind: 'wake' }],
    ['~axo home', { kind: 'home' }],
    ['~axo bye', { kind: 'home' }],
    ['~axo ?', { kind: 'help' }],
    ['~axo say', { kind: 'help' }],
    ['~axo say ship it!', { kind: 'say', text: 'ship it!' }],
    ['~axo you are the best', { kind: 'say', text: 'you are the best' }],
  ] as const)('%j', (input, command) => {
    expect(isAxoInput(input)).toBe(true);
    expect(parseAxoInput(input)).toEqual(command);
  });

  it.each(['~axolotl', 'axo', '/axo', 'hey ~axo', '~ axo', ''])('leaves %j for the agent', (input) => {
    expect(isAxoInput(input)).toBe(false);
    expect(parseAxoInput(input)).toBeNull();
  });
});
