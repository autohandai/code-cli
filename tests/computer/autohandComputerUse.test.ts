/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTOHAND_COMPUTER_USE_APP_NAME,
  AUTOHAND_COMPUTER_USE_BUNDLE_ID,
  buildComputerUsePermissionPlan,
  buildComputerUsePermissionStatusPlan,
  buildComputerUseRegistrationPlan,
  resolveAutohandComputerUseHostPath,
} from '../../src/computer/autohandComputerUse.js';

describe('Autohand Computer Use macOS host', () => {
  it('uses the product name and stable bundle identity shown by macOS Privacy settings', () => {
    expect(AUTOHAND_COMPUTER_USE_APP_NAME).toBe('Autohand Computer Use');
    expect(AUTOHAND_COMPUTER_USE_BUNDLE_ID).toBe('ai.autohand.computer-use');
  });

  it('launches the bundled executable directly to request permissions', () => {
    const plan = buildComputerUsePermissionPlan({
      appPath: '/Users/test/Applications/Autohand Computer Use.app',
      driverPath: '/Users/test/.local/bin/cua-driver',
      resultPath: '/tmp/autohand-computer-use-result.json',
    });

    expect(plan).toEqual({
      command: '/Users/test/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse',
      args: [
        'permissions',
        'grant',
        '--driver-path',
        '/Users/test/.local/bin/cua-driver',
        '--result-path',
        '/tmp/autohand-computer-use-result.json',
      ],
    });
  });

  it('checks permissions through the same bundled executable identity', () => {
    expect(buildComputerUsePermissionStatusPlan({
      appPath: '/Users/test/Applications/Autohand Computer Use.app',
      resultPath: '/tmp/autohand-computer-use-status.json',
    })).toEqual({
      command: '/Users/test/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse',
      args: [
        'permissions',
        'status',
        '--result-path',
        '/tmp/autohand-computer-use-status.json',
      ],
    });
  });

  it('force-registers the installed app before launching its executable', () => {
    expect(buildComputerUseRegistrationPlan(
      '/Users/test/Applications/Autohand Computer Use.app',
    )).toEqual({
      command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      args: ['-f', '/Users/test/Applications/Autohand Computer Use.app'],
    });
  });

  it('finds the installed host executable inside the branded app bundle', () => {
    const expected = path.join(
      '/Users/test/Applications',
      'Autohand Computer Use.app',
      'Contents',
      'MacOS',
      'AutohandComputerUse',
    );

    expect(resolveAutohandComputerUseHostPath({
      platform: 'darwin',
      homeDir: '/Users/test',
      env: {},
      isExecutable: (candidate) => candidate === expected,
    })).toBe(expected);
    expect(resolveAutohandComputerUseHostPath({
      platform: 'linux',
      homeDir: '/home/test',
      env: {},
      isExecutable: () => true,
    })).toBeNull();
  });

  it('treats an explicit host path as authoritative', () => {
    expect(resolveAutohandComputerUseHostPath({
      platform: 'darwin',
      homeDir: '/Users/test',
      env: {
        AUTOHAND_COMPUTER_USE_APP_PATH: '/missing/Autohand Computer Use.app',
        PATH: '/path/with/a/host',
      },
      isExecutable: (candidate) => candidate.includes('/path/with/a/host'),
    })).toBeNull();
  });
});
