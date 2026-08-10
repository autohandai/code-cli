/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  matchesBrainstormIntent,
  resolveBrainstormAutoInjection,
} from '../../src/skills/brainstormIntent.js';

describe('matchesBrainstormIntent', () => {
  const positives = [
    'brainstorm the API surface',
    'let us brainstorm',
    "let's brainstorm the caching layer",
    "let's design the auth flow",
    'lets design a new onboarding screen',
    'help me design the data model',
    'how should we build the payment module',
    'how should we architect this service',
    'how should we structure the monorepo',
    'how would you design a rate limiter',
    'how do we build a resilient queue',
    "what's the best approach for pagination",
    'what is the best architecture for this',
    'help me think through the migration',
    'spec out the new feature',
    'spec it out before we code',
    'weigh the tradeoffs between REST and gRPC',
    'weigh the options for storage',
    'compare the approaches for state management',
    'explore alternatives for the scheduler',
    'help me plan the architecture',
    'design a new billing subsystem',
  ];

  it.each(positives)('detects brainstorm intent in: %s', (instruction) => {
    expect(matchesBrainstormIntent(instruction)).toBe(true);
  });

  const negatives = [
    'fix the bug in auth.ts',
    'the design is broken, please fix it',
    'add a new endpoint for users',
    'run the tests',
    'commit my changes',
    'read src/index.ts',
    'refactor this function',
    'designated the owner in the config',
    'update the README',
    'delete the temp folder',
    'build the project',
    '',
    '   ',
  ];

  it.each(negatives)('does not misfire on: %s', (instruction) => {
    expect(matchesBrainstormIntent(instruction)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesBrainstormIntent('BRAINSTORM the release plan')).toBe(true);
    expect(matchesBrainstormIntent("HOW SHOULD WE BUILD this")).toBe(true);
  });

  it('handles surrounding whitespace', () => {
    expect(matchesBrainstormIntent('   brainstorm this   ')).toBe(true);
  });
});

describe('resolveBrainstormAutoInjection', () => {
  it('injects in plan mode regardless of instruction', () => {
    expect(
      resolveBrainstormAutoInjection({
        instruction: 'fix the bug in auth.ts',
        planModeActive: true,
        alreadyInjected: false,
      }),
    ).toBe(true);
  });

  it('injects in normal mode when the instruction matches intent', () => {
    expect(
      resolveBrainstormAutoInjection({
        instruction: "let's design the auth flow",
        planModeActive: false,
        alreadyInjected: false,
      }),
    ).toBe(true);
  });

  it('does not inject in normal mode when intent does not match', () => {
    expect(
      resolveBrainstormAutoInjection({
        instruction: 'run the tests',
        planModeActive: false,
        alreadyInjected: false,
      }),
    ).toBe(false);
  });

  it('never double-injects when the skill was already mentioned this turn', () => {
    expect(
      resolveBrainstormAutoInjection({
        instruction: "let's design the auth flow",
        planModeActive: true,
        alreadyInjected: true,
      }),
    ).toBe(false);
  });
});
