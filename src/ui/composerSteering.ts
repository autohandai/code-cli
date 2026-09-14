/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { isLeadingTargetInput } from './messageTargets.js';
import { isImmediateCommand } from './shellCommand.js';

/**
 * Whether composer text may be steered into (or queued behind) the running
 * turn. Shell commands, slash commands, and `:alias` sends run the moment they
 * are submitted, whatever ui.enterWhileWorking says; only ordinary prose is
 * for the model.
 */
export function canSteerComposerInput(text: string): boolean {
  return !isImmediateCommand(text) && !isLeadingTargetInput(text);
}
