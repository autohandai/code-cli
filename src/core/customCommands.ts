/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';

export interface CustomCommandDefinition {
  name: string;
  command: string;
  args?: string[];
  description?: string;
  dangerous?: boolean;
}

const COMMANDS_DIR = AUTOHAND_PATHS.commands;

export async function loadCustomCommand(name: string): Promise<CustomCommandDefinition | null> {
  const filePath = path.join(COMMANDS_DIR, `${sanitizeName(name)}.json`);
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  return fs.readJson(filePath) as Promise<CustomCommandDefinition>;
}

export async function saveCustomCommand(definition: CustomCommandDefinition): Promise<void> {
  await fs.ensureDir(COMMANDS_DIR);
  const filePath = path.join(COMMANDS_DIR, `${sanitizeName(definition.name)}.json`);
  await fs.writeJson(filePath, definition, { spaces: 2 });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, '_');
}
