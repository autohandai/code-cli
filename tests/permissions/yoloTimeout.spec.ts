/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import { buildPermissionSettingsFromYolo, parseYoloPattern } from '../../src/permissions/yoloMode.js';

describe('--yolo with --timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns to the pre-yolo mode once the window ends', () => {
    const baseline = { mode: 'interactive' as const, denyList: ['run_command:sudo *'] };
    const manager = new PermissionManager({
      settings: { ...baseline, ...buildPermissionSettingsFromYolo(parseYoloPattern('allow:*')) },
    });
    manager.expireAutoApprovalAfter(30, baseline);

    expect(manager.getMode()).toBe('unrestricted');
    expect(manager.checkPermission({ tool: 'run_command', command: 'npm', args: ['test'] })).toMatchObject({ allowed: true });

    vi.advanceTimersByTime(31_000);

    expect(manager.checkPermission({ tool: 'run_command', command: 'npm', args: ['test'] })).not.toMatchObject({ allowed: true, reason: 'mode_unrestricted' });
    expect(manager.getMode()).toBe('interactive');
    expect(manager.getSettings().denyList).toEqual(['run_command:sudo *']);
  });

  it('drops yolo tool patterns once the window ends', () => {
    const baseline = { mode: 'interactive' as const };
    const manager = new PermissionManager({
      settings: { ...baseline, ...buildPermissionSettingsFromYolo(parseYoloPattern('allow:write_file')) },
    });
    manager.expireAutoApprovalAfter(10, baseline);

    expect(manager.checkPermission({ tool: 'write_file', path: 'src/a.ts' })).toMatchObject({ allowed: true });

    vi.advanceTimersByTime(11_000);

    expect(manager.checkPermission({ tool: 'write_file', path: 'src/a.ts' })).not.toMatchObject({ allowed: true, reason: 'pattern_allowed' });
    expect(manager.getSettings().allowPatterns).toEqual([]);
  });

  it('notifies the caller once so it can clear the runtime yolo option', () => {
    const onExpire = vi.fn();
    const manager = new PermissionManager({ settings: { mode: 'unrestricted' } });
    manager.expireAutoApprovalAfter(5, { mode: 'interactive' }, onExpire);

    manager.checkPermission({ tool: 'read_file', path: 'a.ts' });
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6_000);
    manager.checkPermission({ tool: 'read_file', path: 'a.ts' });
    manager.checkPermission({ tool: 'read_file', path: 'a.ts' });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('ignores a zero or missing timeout', () => {
    const manager = new PermissionManager({ settings: { mode: 'unrestricted' } });
    manager.expireAutoApprovalAfter(0, { mode: 'interactive' });
    vi.advanceTimersByTime(60_000);
    expect(manager.getMode()).toBe('unrestricted');
  });
});
