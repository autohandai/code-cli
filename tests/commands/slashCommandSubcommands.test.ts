/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: slash commands that handle subcommands must declare them
 * in their metadata so the autocomplete/hint system can display them.
 */

import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';

describe('slash command subcommand metadata', () => {
  it('/repeat declares list, cancel, help subcommands', () => {
    const repeat = SLASH_COMMANDS.find((c) => c.command === '/repeat');
    expect(repeat).toBeDefined();
    expect(repeat!.subcommands).toBeDefined();
    expect(repeat!.subcommands!.length).toBeGreaterThanOrEqual(3);

    const names = repeat!.subcommands!.map((s) => s.name);
    expect(names).toContain('list');
    expect(names).toContain('cancel');
    expect(names).toContain('help');
  });

  it('/learn declares deep and update subcommands', () => {
    const learn = SLASH_COMMANDS.find((c) => c.command === '/learn');
    expect(learn).toBeDefined();
    expect(learn!.subcommands).toBeDefined();

    const names = learn!.subcommands!.map((s) => s.name);
    expect(names).toContain('deep');
    expect(names).toContain('update');
  });

  it('every command with subcommands has descriptions', () => {
    for (const cmd of SLASH_COMMANDS) {
      if (!cmd.subcommands) continue;
      for (const sub of cmd.subcommands) {
        expect(sub.name, `${cmd.command} subcommand missing name`).toBeTruthy();
        expect(sub.description, `${cmd.command} ${sub.name} missing description`).toBeTruthy();
      }
    }
  });
});
