/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isLikelyFilePathSlashInput } from '../../src/core/slashInputDetection.js';

describe('isLikelyFilePathSlashInput', () => {
  it('detects absolute file paths', () => {
    expect(isLikelyFilePathSlashInput('/Users/me/project/file.ts')).toBe(true);
    expect(isLikelyFilePathSlashInput('/tmp/test.txt')).toBe(true);
    expect(isLikelyFilePathSlashInput('/opt/bin/script.sh --flag')).toBe(true);
  });

  it('does not classify slash commands as file paths', () => {
    expect(isLikelyFilePathSlashInput('/mcp')).toBe(false);
    expect(isLikelyFilePathSlashInput('/mcp add playwright npx @playwright/mcp@latest')).toBe(false);
    expect(isLikelyFilePathSlashInput('/mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest')).toBe(false);
  });

  it('ignores non-slash input', () => {
    expect(isLikelyFilePathSlashInput('mcp add')).toBe(false);
    expect(isLikelyFilePathSlashInput('@playwright/mcp@latest')).toBe(false);
  });
});

