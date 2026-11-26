/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_APPROVAL_LIFECYCLE, PermissionManager } from '../../src/permissions/PermissionManager.js';
import { buildPermissionSettingsFromYolo, parseYoloPattern } from '../../src/permissions/yoloMode.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const WRITE = { tool: 'write_file' as const, path: 'notes.txt' };

describe('read-only review scope', () => {
  it('stays read-only until every overlapping review is released, in any order', () => {
    const manager = new PermissionManager({ settings: { mode: 'unrestricted' } });
    const releaseFirst = manager.beginReadOnlyReview();
    const releaseSecond = manager.beginReadOnlyReview();

    releaseFirst();
    expect(manager.isReadOnlyReview()).toBe(true);
    expect(manager.checkPermission(WRITE).allowed).toBe(false);

    releaseSecond();
    expect(manager.isReadOnlyReview()).toBe(false);
  });

  it('treats a repeated release as a no-op', () => {
    const manager = new PermissionManager();
    const releaseFirst = manager.beginReadOnlyReview();
    const releaseSecond = manager.beginReadOnlyReview();

    releaseFirst();
    releaseFirst();
    expect(manager.isReadOnlyReview()).toBe(true);
    releaseSecond();
    expect(manager.isReadOnlyReview()).toBe(false);
  });

  it('restores the previous state for nested reviews released in order', () => {
    const manager = new PermissionManager();
    const outer = manager.beginReadOnlyReview();
    const inner = manager.beginReadOnlyReview();
    inner();
    expect(manager.isReadOnlyReview()).toBe(true);
    outer();
    expect(manager.isReadOnlyReview()).toBe(false);
  });
});

describe('auto-approval window lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('declares off -> armed -> expired with re-arming allowed', () => {
    expect(terminalStates(AUTO_APPROVAL_LIFECYCLE)).toEqual([]);
    expect([...reachableStates(AUTO_APPROVAL_LIFECYCLE)].sort()).toEqual(['armed', 'expired', 'off']);
    const machine = new StateMachine(AUTO_APPROVAL_LIFECYCLE);
    expect(machine.can('expire')).toBe(false);
    expect(machine.send('arm')).toBe('armed');
    expect(machine.send('arm')).toBe('armed');
    expect(machine.send('expire')).toBe('expired');
    expect(machine.can('expire')).toBe(false);
    expect(machine.send('arm')).toBe('armed');
  });

  it('accepts exactly the table edges for any event sequence', () => {
    randomEventWalk(AUTO_APPROVAL_LIFECYCLE, ['arm', 'expire'], { seeds: 30, steps: 40 });
  });

  it('re-arming after expiry starts a fresh window that expires again', () => {
    const baseline = { mode: 'interactive' as const };
    const manager = new PermissionManager({ settings: { ...baseline, ...buildPermissionSettingsFromYolo(parseYoloPattern('allow:*')) } });
    const onExpire = vi.fn();
    manager.expireAutoApprovalAfter(5, baseline, onExpire);
    vi.advanceTimersByTime(6_000);
    manager.checkPermission(WRITE);
    expect(manager.getMode()).toBe('interactive');

    manager.setMode('unrestricted');
    manager.expireAutoApprovalAfter(5, baseline, onExpire);
    expect(manager.checkPermission(WRITE)).toMatchObject({ allowed: true });
    vi.advanceTimersByTime(6_000);
    manager.checkPermission(WRITE);
    expect(manager.getMode()).toBe('interactive');
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
