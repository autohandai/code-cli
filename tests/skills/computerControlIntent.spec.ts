/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  matchesComputerControlIntent,
  resolveComputerControlAutoInjection,
} from '../../src/skills/computerControlIntent.js';

describe('matchesComputerControlIntent', () => {
  const positives = [
    'open my browser',
    'open Spotify on my computer',
    'go to Spotify and play Midnight City',
    'play Dreams by Fleetwood Mac on Spotify',
    'use my computer to open Slack',
    'click Settings in the Slack app',
    'scroll down in Chrome',
    'type hello into the Notes app',
    'take a screenshot of my desktop',
    'switch to the Finder window',
    'control my laptop and close the dialog',
  ];

  it.each(positives)('detects native computer control intent in: %s', (instruction) => {
    expect(matchesComputerControlIntent(instruction)).toBe(true);
  });

  const negatives = [
    'build a browser extension',
    'open src/index.ts and fix the type error',
    'implement our Spotify integration',
    'the browser tests are failing',
    'add a screenshot test for this component',
    'open a pull request',
    'update the desktop app source code',
    'document how to click the button',
    '',
  ];

  it.each(negatives)('does not misfire on development work: %s', (instruction) => {
    expect(matchesComputerControlIntent(instruction)).toBe(false);
  });
});

describe('resolveComputerControlAutoInjection', () => {
  it('injects for matching intent and avoids duplicate explicit activation', () => {
    expect(resolveComputerControlAutoInjection({
      instruction: 'open my browser',
      alreadyInjected: false,
    })).toBe(true);
    expect(resolveComputerControlAutoInjection({
      instruction: 'open my browser with $computer-control',
      alreadyInjected: true,
    })).toBe(false);
  });
});
