/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { launchDetached, openPlanFile, type PlanFileLauncher } from '../../../src/modes/planMode/openPlanFile.js';

const FILE = '/home/user/.autohand/plans/plan-abc.md';

function launcher(available: string[]): PlanFileLauncher {
  return vi.fn(async (command: string) => available.includes(command));
}

describe('openPlanFile', () => {
  it('opens the plan in VS Code when the code launcher is installed', async () => {
    const launch = launcher(['code', 'open']);

    await expect(openPlanFile(FILE, { launch, platform: 'darwin' })).resolves.toBe('code');
    expect(launch).toHaveBeenCalledExactlyOnceWith('code', ['--reuse-window', FILE]);
  });

  it.each([
    ['darwin', 'open', [FILE]],
    ['linux', 'xdg-open', [FILE]],
    ['win32', 'cmd', ['/c', 'start', '""', FILE]],
  ] as const)('falls back to the %s default application', async (platform, command, args) => {
    const launch = launcher([command]);

    await expect(openPlanFile(FILE, { launch, platform })).resolves.toBe(command);
    expect(launch).toHaveBeenLastCalledWith(command, args);
  });

  it('reports that nothing could open the file', async () => {
    const launch = launcher([]);

    await expect(openPlanFile(FILE, { launch, platform: 'linux' })).resolves.toBeNull();
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('treats a launcher that throws as unavailable', async () => {
    const launch: PlanFileLauncher = vi.fn(async (command: string) => {
      if (command === 'code') throw new Error('spawn EACCES');
      return true;
    });

    await expect(openPlanFile(FILE, { launch, platform: 'darwin' })).resolves.toBe('open');
  });

  it('resolves false from the real launcher for a program that does not exist', async () => {
    await expect(launchDetached('autohand-no-such-program-for-tests', [FILE])).resolves.toBe(false);
  });
});
