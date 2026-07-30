/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import type { SlashCommand } from '../../src/core/slashCommandTypes.js';
import {
  MOBILE_COMPOSER_CATALOG_SCHEMA_VERSION,
  buildMobileComposerCatalog,
} from '../../src/mobile/MobileComposerCatalog.js';
import {
  isMobileCommandPermitted,
  isMobileSubcommandPermitted,
  validateMobileCommandInvocation,
  validateMobileCommandInvocationForWorkspace,
} from '../../src/mobile/MobileCommandPolicy.js';

const MOBILE_EXECUTABLE_COMMANDS = [
  '/plan',
  '/goal',
  '/deep-research',
  '/autoresearch',
  '/automode',
];

describe('mobile composer command catalog', () => {
  it('derives a deterministic versioned catalog from the canonical slash registry', () => {
    const first = buildMobileComposerCatalog(SLASH_COMMANDS);
    const second = buildMobileComposerCatalog(SLASH_COMMANDS);
    const automode = first.commands.find(({ command }) => command === '/automode');
    const canonicalAutomode = SLASH_COMMANDS.find(({ command }) => command === '/automode');

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(MOBILE_COMPOSER_CATALOG_SCHEMA_VERSION);
    expect(first.revision).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(first.commands).toHaveLength(SLASH_COMMANDS.length);
    expect(automode).toEqual({
      command: '/automode',
      description: canonicalAutomode?.description,
      available: false,
      subcommands: canonicalAutomode?.subcommands?.map(({ name, description }) => ({
        name,
        description,
        available: false,
      })),
    });
    expect(first.commands.some(({ command }) => command === '/automodo')).toBe(false);
  });

  it('fails closed unless both the explicit policy and execution availability allow a command', () => {
    for (const command of MOBILE_EXECUTABLE_COMMANDS) {
      expect(isMobileCommandPermitted(command)).toBe(true);
    }
    expect(isMobileSubcommandPermitted('/automode', 'status')).toBe(true);
    expect(isMobileSubcommandPermitted('/goal', 'writer')).toBe(true);
    expect(isMobileSubcommandPermitted('/goal', 'clear')).toBe(false);
    expect(isMobileSubcommandPermitted('/autoresearch', 'status')).toBe(true);
    expect(isMobileSubcommandPermitted('/autoresearch', 'clear')).toBe(false);
    expect(isMobileSubcommandPermitted('/autoresearch', 'prune')).toBe(false);
    expect(isMobileCommandPermitted('/help')).toBe(false);
    expect(isMobileCommandPermitted('/future-command')).toBe(false);
    expect(isMobileSubcommandPermitted('/automode', 'future-subcommand')).toBe(false);
    expect(isMobileCommandPermitted('/automodo')).toBe(false);

    const catalog = buildMobileComposerCatalog(SLASH_COMMANDS, {
      commandExecutionAvailable: () => true,
    });
    expect(catalog.commands.filter(({ available }) => available).map(({ command }) => command).sort())
      .toEqual([...MOBILE_EXECUTABLE_COMMANDS].sort());
    expect(catalog.commands.find(({ command }) => command === '/help')?.available).toBe(false);
  });

  it.each([
    ['/plan', ['on']],
    ['/plan', ['off']],
    ['/plan', ['status']],
    ['/goal', ['writer']],
    ['/goal', ['writer', 'Ship', 'the', 'mobile', 'flow']],
    ['/goal', ['Ship', 'the', 'mobile', 'flow']],
    ['/goal', ['templates']],
    ['/deep-research', ['status']],
    ['/deep-research', ['Compare', 'agent', 'routing', 'systems']],
    ['/autoresearch', ['status']],
    ['/autoresearch', ['history']],
    ['/autoresearch', ['pareto']],
    ['/autoresearch', ['off']],
    ['/autoresearch', ['Improve', 'relay', 'latency']],
    ['/automode', ['on']],
    ['/automode', ['off']],
    ['/automode', ['status']],
    ['/automode', ['pause']],
    ['/automode', ['resume']],
    ['/automode', ['cancel']],
  ])('allows the canonical mobile invocation %s %j', (command, args) => {
    expect(validateMobileCommandInvocation(command, args)).toEqual({ allowed: true });
  });

  it.each([
    ['/plan', []],
    ['/plan', ['enable']],
    ['/goal', ['clear']],
    ['/goal', ['queue', 'hidden objective']],
    ['/deep-research', []],
    ['/deep-research', ['status', 'extra']],
    ['/autoresearch', ['clear', '--yes']],
    ['/autoresearch', ['prune']],
    ['/autoresearch', ['prune', '--yes']],
    ['/autoresearch', ['Improve', 'latency', '--measure-command', 'rm -rf output']],
    ['/autoresearch', ['replay', 'attempt-1']],
    ['/automode', []],
    ['/automode', ['Build', 'a', 'feature']],
    ['/automodo', ['on']],
    ['/help', []],
  ])('rejects the unallowlisted mobile invocation %s %j', (command, args) => {
    expect(validateMobileCommandInvocation(command, args)).toMatchObject({
      allowed: false,
      reason: expect.any(String),
    });
  });

  it('rejects local command-capable goal templates by name and alias without executing them', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-policy-'));
    const executionMarker = path.join(workspaceRoot, 'template-executed.txt');

    try {
      await fs.outputFile(path.join(workspaceRoot, '.pi-goals', 'dangerous-workflow.md'), [
        '---',
        'description: A command-capable local workflow',
        'aliases: dangerous-alias',
        'allow_commands: true',
        '---',
        'Protected output: !`touch template-executed.txt`',
      ].join('\n'));

      const byName = await validateMobileCommandInvocationForWorkspace(
        '/goal',
        ['dangerous-workflow'],
        workspaceRoot,
      );
      const byAlias = await validateMobileCommandInvocationForWorkspace(
        '/goal',
        ['dangerous-alias'],
        workspaceRoot,
      );

      expect(byName).toMatchObject({
        allowed: false,
        reason: expect.stringContaining('templates are not executable'),
      });
      expect(byAlias).toMatchObject({
        allowed: false,
        reason: expect.stringContaining('templates are not executable'),
      });
      expect(await fs.pathExists(executionMarker)).toBe(false);
    } finally {
      await fs.remove(workspaceRoot);
    }
  });

  it('marks unimplemented and non-policy descriptors unavailable without inventing commands', () => {
    const commands: SlashCommand[] = [
      {
        command: '/automode',
        description: 'Canonical auto mode',
        implemented: false,
        subcommands: [{ name: 'status', description: 'Show status' }],
      },
      {
        command: '/future-command',
        description: 'Not approved for mobile',
        implemented: true,
      },
    ];

    expect(buildMobileComposerCatalog(commands).commands).toEqual([
      {
        command: '/automode',
        description: 'Canonical auto mode',
        available: false,
        subcommands: [{
          name: 'status',
          description: 'Show status',
          available: false,
        }],
      },
      {
        command: '/future-command',
        description: 'Not approved for mobile',
        available: false,
        subcommands: [],
      },
    ]);
  });
});
