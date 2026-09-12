/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesDebugIntent, resolveDebugAutoInjection } from '../../src/skills/debugIntent.js';

describe('matchesDebugIntent', () => {
  it.each([
    'the build is failing on main',
    'why does the login page crash on submit?',
    'tests keep timing out in CI',
    'this stopped working after the upgrade',
    'TypeError: Cannot read properties of undefined (reading "id")',
    'can you debug the sync job',
    'investigate the regression in the composer',
    'Traceback (most recent call last):',
  ])('matches %j', (text) => {
    expect(matchesDebugIntent(text)).toBe(true);
  });

  it.each([
    'add a bug report form to the settings page',
    'rename the session command',
    'write a changelog entry for the error handling improvements',
    'the design is broken, redo the landing page',
    '',
  ])('ignores %j', (text) => {
    expect(matchesDebugIntent(text)).toBe(false);
  });
});

describe('resolveDebugAutoInjection', () => {
  it('never double-injects and yields to brainstorming', () => {
    expect(resolveDebugAutoInjection({ instruction: 'tests are failing', alreadyInjected: true, brainstormInjected: false })).toBe(false);
    expect(resolveDebugAutoInjection({ instruction: 'tests are failing', alreadyInjected: false, brainstormInjected: true })).toBe(false);
    expect(resolveDebugAutoInjection({ instruction: 'tests are failing', alreadyInjected: false, brainstormInjected: false })).toBe(true);
  });
});
