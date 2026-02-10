/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import terminalLink from 'terminal-link';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { detectRunningIDEs, getExtensionSuggestions } from '../core/ide/ideDetector.js';
import type { DetectedIDE } from '../core/ide/ideTypes.js';
import type { IDEKind } from '../core/ide/ideTypes.js';
import { t } from '../i18n/index.js';

interface IDEContext {
  workspaceRoot: string;
}

/**
 * Group detected IDE entries by kind.
 * Returns IDEs that match cwd (one entry per IDE) and IDEs that don't.
 */
function groupByIDE(detected: DetectedIDE[]): {
  matching: DetectedIDE[];
  nonMatching: Map<IDEKind, DetectedIDE>;
} {
  const matching: DetectedIDE[] = [];
  const matchedKinds = new Set<IDEKind>();
  const nonMatching = new Map<IDEKind, DetectedIDE>();

  // First pass: find all matching entries
  for (const ide of detected) {
    if (ide.matchesCwd) {
      matching.push(ide);
      matchedKinds.add(ide.kind);
    }
  }

  // Second pass: for each IDE kind that didn't match, keep one representative entry
  for (const ide of detected) {
    if (matchedKinds.has(ide.kind)) continue;
    if (nonMatching.has(ide.kind)) continue;
    nonMatching.set(ide.kind, ide);
  }

  return { matching, nonMatching };
}

/**
 * /ide command - Detect running IDEs and connect to one for integrated features.
 */
export async function ide(ctx: IDEContext): Promise<string | null> {
  console.log(chalk.bold.cyan(`\n${t('commands.ide.title')}`));
  console.log(chalk.gray(t('commands.ide.connectDescription')));
  console.log();

  const detected = await detectRunningIDEs(ctx.workspaceRoot);
  const { matching, nonMatching } = groupByIDE(detected);

  // Case 1: No IDEs running at all
  if (detected.length === 0) {
    console.log(chalk.yellow(t('commands.ide.noIdesDetected')));
    console.log();
    printExtensionSuggestions(detected);
    return null;
  }

  // Case 2: IDEs running but none match cwd
  if (matching.length === 0) {
    console.log(chalk.yellow(t('commands.ide.noMatchingIdes')));
    console.log();

    if (nonMatching.size > 0) {
      console.log(
        chalk.gray(
          t('commands.ide.otherNotMatching', { count: String(nonMatching.size) })
        )
      );
      console.log();
      printNonMatchingIDEs([...nonMatching.values()]);
    }

    printExtensionSuggestions(detected);
    return null;
  }

  // Case 3: One or more IDEs match cwd - show selection modal
  console.log(
    chalk.green(
      t('commands.ide.foundMatching', { count: String(matching.length) })
    )
  );
  console.log();

  const options: ModalOption[] = matching.map((ide) => ({
    label: `${ide.displayName}: ${ide.workspacePath ?? t('common.unknown')}`,
    value: ide.kind,
  }));

  const result = await showModal({
    title: t('commands.ide.selectPrompt'),
    options,
  });

  if (!result) {
    console.log(chalk.gray(`\n${t('common.cancelled')}`));
    return null;
  }

  const selected = matching.find((d) => d.kind === result.value);
  if (selected) {
    console.log(
      chalk.green(
        `\n\u2713 ${t('commands.ide.connected', { ide: selected.displayName })}`
      )
    );
  }

  // Show non-matching IDEs below
  if (nonMatching.size > 0) {
    console.log();
    console.log(
      chalk.gray(
        t('commands.ide.otherNotMatching', { count: String(nonMatching.size) })
      )
    );
    console.log();
    printNonMatchingIDEs([...nonMatching.values()]);
  }

  printExtensionSuggestions(detected);
  return null;
}

/**
 * Print the list of non-matching IDE instances (one per IDE kind).
 */
function printNonMatchingIDEs(ides: DetectedIDE[]): void {
  for (const ide of ides) {
    const wsPath = ide.workspacePath ?? t('common.unknown');
    console.log(chalk.gray(`  \u2022 ${ide.displayName}: ${wsPath}`));
  }
  console.log();
}

/**
 * Print extension installation suggestions for IDEs that have them.
 */
function printExtensionSuggestions(detected: DetectedIDE[]): void {
  const suggestions = getExtensionSuggestions(detected);
  if (suggestions.length === 0) return;

  console.log(chalk.dim(`\u{1F4A1} ${t('commands.ide.extensionHint')}`));

  for (const suggestion of suggestions) {
    const link = terminalLink(suggestion.url, suggestion.url);
    console.log(chalk.dim(`  \u2022 ${suggestion.displayName}: ${link}`));
  }
  console.log();
}

export const metadata = {
  command: '/ide',
  description: t('commands.ide.description'),
  implemented: true,
};
