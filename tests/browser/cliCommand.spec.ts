/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  registerBrowserCommand,
  registerBrowserOptions,
} from '../../src/browser/cliCommand.js';

function createProgram(): Command {
  const program = new Command().name('autohand');
  registerBrowserCommand(program);
  registerBrowserOptions(program);
  program.action(() => undefined);
  return program;
}

describe('browser CLI contract', () => {
  it('advertises only canonical browser flags and commands', () => {
    const help = createProgram().helpInformation();

    expect(help).toContain('--browser');
    expect(help).toContain('--no-browser');
    expect(help).not.toContain('--chrome');
    expect(help).not.toContain('--no-chrome');
    expect(help).toMatch(/^\s+browser\s/mu);
    expect(help).not.toMatch(/^\s+chrome\s/mu);
  });

  it.each([
    { flag: '--browser', expected: { browser: true } },
    { flag: '--no-browser', expected: { browser: false } },
    { flag: '--chrome', expected: { chrome: true } },
    { flag: '--no-chrome', expected: { chrome: false } },
  ])('accepts $flag at the compatibility boundary', ({ flag, expected }) => {
    const program = createProgram();

    program.parse(['node', 'autohand', flag]);

    expect(program.opts()).toMatchObject(expected);
  });

  it('retains the Chrome command route without exposing it in help', () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());
    const browserCommand = program.commands.find((command) => command.name() === 'browser');
    const legacyCommand = program.commands.find((command) => command.name() === 'chrome');

    expect(commandNames).toEqual(expect.arrayContaining(['browser', 'chrome']));
    expect(browserCommand?.commands.map((command) => command.name())).toEqual(['install']);
    expect(legacyCommand?.commands.map((command) => command.name())).toEqual(['install']);
  });
});
