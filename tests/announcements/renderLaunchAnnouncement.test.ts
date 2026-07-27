/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { renderLaunchAnnouncement } from '../../src/announcements/renderLaunchAnnouncement.js';

describe('renderLaunchAnnouncement', () => {
  it('renders one announcement and a compact backlog hint', () => {
    expect(renderLaunchAnnouncement({
      id: 'one',
      headline: 'Voice dictation is here',
      bodyLines: ['First paragraph', 'Second paragraph'],
      cta: '→ https://example.com/voice',
      priority: 100,
      lineLastStep: 0,
      lastStep: 1,
    }, 3)).toEqual([
      " ◆ What's new  ·  Voice dictation is here",
      '   First paragraph',
      '   Second paragraph',
      '   → https://example.com/voice',
      '   +2 more · /whatsnew',
    ]);
  });
});
