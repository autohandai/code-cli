/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as ls from '../commands/ls.js';
import * as diff from '../commands/diff.js';
import * as undo from '../commands/undo.js';
import * as model from '../commands/model.js';
import * as approvals from '../commands/approvals.js';
import * as review from '../commands/review.js';
import * as newCmd from '../commands/new.js';
import * as init from '../commands/init.js';
import * as compact from '../commands/compact.js';
import * as quit from '../commands/quit.js';
import * as help from '../commands/help.js';
import * as resume from '../commands/resume.js';
import * as sessions from '../commands/sessions.js';

export interface SlashCommand {
  command: string;
  description: string;
  implemented: boolean;
  prd?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  ls.metadata,
  quit.metadata,
  model.metadata,
  approvals.metadata,
  review.metadata,
  newCmd.metadata,
  init.metadata,
  compact.metadata,
  undo.metadata,
  diff.metadata,
  help.metadata,
  resume.metadata,
  sessions.metadata
];
