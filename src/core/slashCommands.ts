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
import * as undo from '../commands/undo.js';
import * as newCmd from '../commands/new.js';
import * as memory from '../commands/memory.js';
import * as formatters from '../commands/formatters.js';
import * as lint from '../commands/lint.js';
import * as completion from '../commands/completion.js';
import * as exportCmd from '../commands/export.js';
import * as status from '../commands/status.js';
import * as login from '../commands/login.js';
import * as logout from '../commands/logout.js';
import * as permissions from '../commands/permissions.js';
import * as hooks from '../commands/hooks.js';
import * as skills from '../commands/skills.js';
import * as skillsNew from '../commands/skills-new.js';
import * as theme from '../commands/theme.js';
import * as automode from '../commands/automode.js';
import * as share from '../commands/share.js';
import * as sync from '../commands/sync.js';
import * as addDir from '../commands/add-dir.js';
import * as language from '../commands/language.js';
import * as plan from '../commands/plan.js';

import type { SlashCommand } from './slashCommandTypes.js';
export type { SlashCommand } from './slashCommandTypes.js';

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
  feedback.metadata,
  undo.metadata,
  newCmd.metadata,
  memory.metadata,
  formatters.metadata,
  lint.metadata,
  completion.metadata,
  exportCmd.metadata,
  status.metadata,
  login.metadata,
  logout.metadata,
  permissions.metadata,
  hooks.metadata,
  skills.metadata,
  skills.installMetadata,
  skillsNew.metadata,
  theme.metadata,
  automode.metadata,
  share.metadata,
  sync.metadata,
  addDir.metadata,
  language.metadata,
  plan.metadata,
];
