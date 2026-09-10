/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  getCommandPrefix,
  isAllowedPermissionPrompt,
  normalizePermissionPromptResponse,
} from '../../src/permissions/types.js';

describe('permission prompt decisions', () => {
  it.each(['allow_prefix_project', 'allow_prefix_user'] as const)('treats %s as an allowed decision', (decision) => {
    expect(normalizePermissionPromptResponse({ decision })).toEqual({ decision });
    expect(isAllowedPermissionPrompt({ decision })).toBe(true);
  });

  it.each([
    ['git status --porcelain', 'git'],
    ['  npm run build', 'npm'],
    ['"/usr/bin/node" -e 1', '"/usr/bin/node"'],
    ['', undefined],
    ['   ', undefined],
    [undefined, undefined],
  ])('extracts the executable prefix from %j', (command, expected) => {
    expect(getCommandPrefix(command)).toBe(expected);
  });
});
