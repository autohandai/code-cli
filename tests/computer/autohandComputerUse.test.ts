/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AUTOHAND_COMPUTER_USE_APP_NAME,
  AUTOHAND_COMPUTER_USE_BUNDLE_ID,
  buildComputerUsePermissionPlan,
  buildComputerUsePermissionStatusPlan,
  buildComputerUseRegistrationPlan,
  inspectAutohandComputerUsePermissions,
  requestComputerUsePermissions,
  resolveAutohandComputerUseHostPath,
} from '../../src/computer/autohandComputerUse.js';

describe('Autohand Computer Use macOS host', () => {
  it('uses the product name and stable bundle identity shown by macOS Privacy settings', () => {
    expect(AUTOHAND_COMPUTER_USE_APP_NAME).toBe('Autohand Computer Use');
    expect(AUTOHAND_COMPUTER_USE_BUNDLE_ID).toBe('ai.autohand.computer-use');
  });

  it('launches the app through LaunchServices without waiting on its short-lived process', () => {
    const plan = buildComputerUsePermissionPlan({
      appPath: '/Users/test/Applications/Autohand Computer Use.app',
      driverPath: '/Users/test/.local/bin/cua-driver',
      resultPath: '/tmp/autohand-computer-use-result.json',
    });

    expect(plan).toEqual({
      command: '/usr/bin/open',
      args: [
        '-n',
        '-g',
        '/Users/test/Applications/Autohand Computer Use.app',
        '--args',
        'permissions',
        'grant',
        '--driver-path',
        '/Users/test/.local/bin/cua-driver',
        '--result-path',
        '/tmp/autohand-computer-use-result.json',
      ],
    });
  });

  it('checks permissions through the same LaunchServices app identity', () => {
    expect(buildComputerUsePermissionStatusPlan({
      appPath: '/Users/test/Applications/Autohand Computer Use.app',
      resultPath: '/tmp/autohand-computer-use-status.json',
    })).toEqual({
      command: '/usr/bin/open',
      args: [
        '-n',
        '-g',
        '/Users/test/Applications/Autohand Computer Use.app',
        '--args',
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

  it('uses a fresh status process to verify that requested permissions persisted', async () => {
    const operations: string[] = [];
    const permissions = await requestComputerUsePermissions(
      '/Users/test/Applications/Autohand Computer Use.app',
      '/Users/test/.local/bin/cua-driver',
      async (plan) => {
        const operation = plan.args[plan.args.indexOf('permissions') + 1];
        const resultFlag = plan.args.indexOf('--result-path');
        const resultPath = plan.args[resultFlag + 1];
        operations.push(operation);
        await writeFile(resultPath, JSON.stringify({
          accessibility: operation === 'grant',
          screenRecording: operation === 'grant',
          bundleIdentifier: AUTOHAND_COMPUTER_USE_BUNDLE_ID,
        }));
      },
    );

    expect(operations).toEqual(['grant', 'status']);
    expect(permissions).toBe('requested');
  });

  it('registers the app immediately before inspecting its permissions', async () => {
    const plans: Array<{ command: string; args: string[] }> = [];
    const permissions = await inspectAutohandComputerUsePermissions(
      '/Users/test/Applications/Autohand Computer Use.app',
      async (plan) => {
        plans.push(plan);
        const resultFlag = plan.args.indexOf('--result-path');
        if (resultFlag !== -1) {
          await writeFile(plan.args[resultFlag + 1], JSON.stringify({
            accessibility: false,
            screenRecording: false,
            bundleIdentifier: AUTOHAND_COMPUTER_USE_BUNDLE_ID,
          }));
        }
      },
    );

    expect(plans.map((plan) => plan.command)).toEqual([
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      '/usr/bin/open',
    ]);
    expect(permissions).toMatchObject({ accessibility: false, screenRecording: false });
  });

  it('continues permission inspection when LaunchServices registration fails', async () => {
    const plans: Array<{ command: string; args: string[] }> = [];
    const permissions = await inspectAutohandComputerUsePermissions(
      '/Users/test/Applications/Autohand Computer Use.app',
      async (plan) => {
        plans.push(plan);
        if (plan.command.endsWith('/lsregister')) {
          throw new Error('failed to scan app: -10822');
        }
        const resultFlag = plan.args.indexOf('--result-path');
        await writeFile(plan.args[resultFlag + 1], JSON.stringify({
          accessibility: true,
          screenRecording: false,
          bundleIdentifier: AUTOHAND_COMPUTER_USE_BUNDLE_ID,
        }));
      },
    );

    expect(plans.map((plan) => plan.command)).toEqual([
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      '/usr/bin/open',
    ]);
    expect(permissions).toMatchObject({ accessibility: true, screenRecording: false });
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
