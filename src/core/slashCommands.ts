/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as model from '../commands/model.js';
import * as init from '../commands/init.js';
import * as quit from '../commands/quit.js';
import * as help from '../commands/help.js';
import * as resume from '../commands/resume.js';
import * as sessions from '../commands/sessions.js';
import * as session from '../commands/session.js';
import * as agents from '../commands/agents.js';
import * as feedback from '../commands/feedback.js';
import * as agentsNew from '../commands/agents-new.js';

export interface SlashCommand {
  command: string;
  description: string;
  implemented: boolean;
  prd?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  quit.metadata,
  model.metadata,
  init.metadata,
  help.metadata,
  help.aliasMetadata,
  resume.metadata,
  sessions.metadata,
  session.metadata,
  agents.metadata,
  agentsNew.metadata,
  feedback.metadata
];
