/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS } from '../src/core/slashCommands.js';

describe('slash commands registry', () => {
  it('includes the /quit command so users can exit quickly', () => {
    const commands = SLASH_COMMANDS.map((cmd) => cmd.command);
    expect(commands).toContain('/quit');
  });
});
