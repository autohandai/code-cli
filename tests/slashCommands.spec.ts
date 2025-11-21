/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS } from '../src/core/slashCommands.js';

describe('slash commands registry', () => {
  it('includes the supported commands and omits legacy ones', () => {
    const commands = SLASH_COMMANDS.map((cmd) => cmd.command);
    const expected = ['/quit', '/model', '/session', '/sessions', '/resume', '/init', '/agents', '/agents new', '/feedback', '/help', '/?'];
    expected.forEach((cmd) => expect(commands).toContain(cmd));
    expect(commands).not.toContain('/ls');
    expect(commands).not.toContain('/diff');
    expect(commands).not.toContain('/undo');
  });
});
