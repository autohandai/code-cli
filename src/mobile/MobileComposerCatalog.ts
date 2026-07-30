/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import {
  isMobileCommandPermitted,
  isMobileSubcommandPermitted,
} from './MobileCommandPolicy.js';

export const MOBILE_COMPOSER_CATALOG_SCHEMA_VERSION = 1;

export interface MobileComposerSubcommandDescriptor {
  name: string;
  description: string;
  available: boolean;
}

export interface MobileComposerCommandDescriptor {
  command: string;
  description: string;
  available: boolean;
  subcommands: MobileComposerSubcommandDescriptor[];
}

export interface MobileComposerCatalog {
  schemaVersion: number;
  revision: string;
  commands: MobileComposerCommandDescriptor[];
}

export interface MobileComposerCatalogOptions {
  commandExecutionAvailable?: (command: string) => boolean;
}

function descriptorFor(
  command: SlashCommand,
  options: MobileComposerCatalogOptions,
): MobileComposerCommandDescriptor {
  const commandAvailable = command.implemented
    && isMobileCommandPermitted(command.command)
    && options.commandExecutionAvailable?.(command.command) === true;
  return {
    command: command.command,
    description: command.description,
    available: commandAvailable,
    subcommands: (command.subcommands ?? []).map(({ name, description }) => ({
      name,
      description,
      available: commandAvailable && isMobileSubcommandPermitted(command.command, name),
    })),
  };
}

export function buildMobileComposerCatalog(
  slashCommands: readonly SlashCommand[],
  options: MobileComposerCatalogOptions = {},
): MobileComposerCatalog {
  const commands = slashCommands.map((command) => descriptorFor(command, options));
  const revisionInput = JSON.stringify({
    schemaVersion: MOBILE_COMPOSER_CATALOG_SCHEMA_VERSION,
    commands,
  });
  const revision = createHash('sha256')
    .update(revisionInput)
    .digest('hex')
    .slice(0, 16);

  return {
    schemaVersion: MOBILE_COMPOSER_CATALOG_SCHEMA_VERSION,
    revision: `sha256:${revision}`,
    commands,
  };
}

export async function buildCanonicalMobileComposerCatalog(
  options: MobileComposerCatalogOptions = {},
): Promise<MobileComposerCatalog> {
  const { SLASH_COMMANDS } = await import('../core/slashCommands.js');
  return buildMobileComposerCatalog(SLASH_COMMANDS, options);
}
