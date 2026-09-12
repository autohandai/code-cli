/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isStartupTimingEnabled, StartupTimeline } from '../../src/startup/startupTimeline.js';

describe('StartupTimeline', () => {
  it('records elapsed and delta per mark and flags the slowest phase', () => {
    const timeline = new StartupTimeline(1_000);
    timeline.mark('config loaded', 1_120);
    timeline.mark('startup checks', 1_170);
    timeline.mark('composer ready', 2_400);

    expect(timeline.list()).toEqual([
      { name: 'config loaded', at: 120, delta: 120 },
      { name: 'startup checks', at: 170, delta: 50 },
      { name: 'composer ready', at: 1_400, delta: 1_230 },
    ]);
    const report = timeline.format();
    expect(report).toContain('Startup timing');
    expect(report).toMatch(/1400 ms {2}\+ 1230 ms {2}composer ready {2}← slowest/);
    expect(report).not.toContain('config loaded  ← slowest');
  });

  it('reports an empty timeline and is enabled by the timing or debug flags', () => {
    expect(new StartupTimeline().format()).toContain('no marks');
    expect(isStartupTimingEnabled({})).toBe(false);
    expect(isStartupTimingEnabled({ AUTOHAND_STARTUP_TIMING: '1' })).toBe(true);
    expect(isStartupTimingEnabled({ AUTOHAND_DEBUG: 'true' })).toBe(true);
  });
});
