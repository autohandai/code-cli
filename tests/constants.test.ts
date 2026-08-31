/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveAutohandHome } from '../src/constants.js';

describe('resolveAutohandHome', () => {
  it('does not create user state under the Windows system directory', () => {
    expect(resolveAutohandHome({
      platform: 'win32',
      homeDirectory: 'C:\\Windows\\System32',
      environment: {
        AUTOHAND_HOME: 'C:\\Windows\\System32\\.autohand',
        USERPROFILE: 'C:\\Users\\Ava',
      },
    })).toBe('C:\\Users\\Ava\\.autohand');
  });

  it('recovers a Windows user home from LOCALAPPDATA when USERPROFILE is unavailable', () => {
    expect(resolveAutohandHome({
      platform: 'win32',
      homeDirectory: 'C:\\Windows\\System32',
      environment: { LOCALAPPDATA: 'C:\\Users\\Ava\\AppData\\Local' },
    })).toBe('C:\\Users\\Ava\\.autohand');
  });

  it('preserves an explicit non-system home override', () => {
    expect(resolveAutohandHome({
      platform: 'win32',
      homeDirectory: 'C:\\Users\\Ava',
      environment: { AUTOHAND_HOME: 'D:\\AutohandData' },
    })).toBe('D:\\AutohandData');
  });
});
