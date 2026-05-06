/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { themedFg } from './Theme.js';

export function formatStartupBanner(logo: string): string {
  return logo
    .split('\n')
    .map((line, index) => themedFg(index % 2 === 0 ? 'accent' : 'borderAccent', line, chalk.cyan))
    .join('\n');
}

export function formatWelcomeVersionPrefix(version: string): string {
  return `${themedFg('accent', '> Autohand', chalk.bold)} ${themedFg('muted', `v${version}`, chalk.gray)}`;
}

export function formatUpdateAvailable(version: string): string {
  return themedFg('warning', ` ⬆ Update available: v${version}`, chalk.yellow);
}

export function formatUpdateReady(): string {
  return themedFg('success', ' ✓ Up to date', chalk.green);
}

export function formatInstallHint(hint: string): string {
  return `${themedFg('muted', '  ↳ Run: ', chalk.gray)}${themedFg('accent', hint, chalk.cyan)}`;
}

export function formatWelcomeGreeting(nameOrEmail: string): string {
  return themedFg('success', `Welcome back, ${nameOrEmail}!`, chalk.green);
}

export function formatWelcomeStatusLine(model: string, ccEnabled: boolean, dir: string): string {
  const ccStatus = ccEnabled
    ? themedFg('success', '[CC: ON]', chalk.green)
    : themedFg('warning', '[CC: OFF]', chalk.yellow);

  return [
    themedFg('muted', 'model:', chalk.gray),
    themedFg('accent', model, chalk.cyan),
    ccStatus,
    themedFg('muted', '| directory:', chalk.gray),
    themedFg('accent', dir, chalk.cyan),
  ].join('  ');
}

export function formatWelcomeTitle(): string {
  return themedFg('muted', 'To get started, describe a task or try one of these commands:', chalk.gray);
}

export function formatWelcomeSuggestion(command: string, description: string): string {
  return themedFg('accent', `${command} `, chalk.cyan) + themedFg('muted', description, chalk.gray);
}

export function formatSessionEnding(): string {
  return themedFg('muted', 'Ending Autohand session.', chalk.gray);
}

export function formatSessionSaved(sessionId: string): string {
  return themedFg('accent', `\u{1F4BE} Session saved: ${sessionId}`, chalk.cyan);
}

export function formatResumeHint(sessionId: string): string {
  return themedFg('muted', `   Resume with: autohand resume ${sessionId}`, chalk.gray);
}

export function formatExitCleanup(): string {
  return themedFg('muted', '\nExiting - clearing queues and stopping...', chalk.gray);
}

export function formatForceExit(): string {
  return themedFg('muted', '\nForce exiting...', chalk.gray);
}
