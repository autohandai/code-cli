/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Import entry point — orchestrates the import flow for both
 * interactive (TTY) and non-interactive (CI/pipe) modes.
 */
import chalk from 'chalk';
import type { ImportOptions, ImportCategory, ImportResult } from './types.js';
import { IMPORT_SOURCES } from './types.js';

/**
 * Run the import command.
 *
 * When stdout is a TTY and no --all/--categories flags are given, launches
 * the interactive Ink wizard. Otherwise runs headless with console output.
 */
export async function runImport(options: ImportOptions): Promise<void> {
  const { ImporterRegistry } = await import('./registry.js');
  const registry = new ImporterRegistry();

  // ── No source specified → detect available ────────────────────────
  if (!options.source) {
    const available = await registry.detectAvailable();

    if (available.length === 0) {
      console.log(chalk.yellow('No supported agents detected on this system.'));
      console.log(chalk.gray('Checked: ' + IMPORT_SOURCES.map(s => `~/.${s}`).join(', ')));
      return;
    }

    if (process.stdout.isTTY && !options.all) {
      const { showImportWizard } = await import('./ui/ImportWizard.js');
      await showImportWizard(registry, options);
      return;
    }

    // Non-interactive with no source: print help
    if (!options.all) {
      console.log(chalk.red('Please specify a source: autohand import <source>'));
      console.log(chalk.gray('Available: ' + available.map(i => i.name).join(', ')));
      process.exit(1);
    }

    // --all with no source: import from all detected agents
    for (const importer of available) {
      console.log(chalk.cyan(`\nImporting from ${importer.displayName}...`));
      const scanResult = await importer.scan();
      const cats = Array.from(scanResult.available.keys());
      if (cats.length === 0) {
        console.log(chalk.gray('  No importable data found.'));
        continue;
      }

      if (options.dryRun) {
        printDryRun(scanResult.available, cats);
        continue;
      }

      const result = await importer.import(cats, (progress) => {
        if (progress.status === 'done') {
          console.log(chalk.green(`  ✓ ${progress.category}: ${progress.current}/${progress.total}`));
        }
      });
      printSummary(result);
    }
    return;
  }

  // ── Source specified ───────────────────────────────────────────────
  const importer = registry.get(options.source);
  if (!importer) {
    console.log(chalk.red(`Unknown import source: ${options.source}`));
    console.log(chalk.gray('Valid sources: ' + IMPORT_SOURCES.map(s => s).join(', ')));
    process.exit(1);
  }

  const exists = await importer.detect();
  if (!exists) {
    console.log(chalk.yellow(`${importer.displayName} not found at ${importer.homePath}`));
    return;
  }

  // Scan
  const scanResult = await importer.scan();
  if (scanResult.available.size === 0) {
    console.log(chalk.yellow(`No importable data found in ${importer.displayName}.`));
    return;
  }

  // Determine categories
  let categories: ImportCategory[];
  if (options.all) {
    categories = Array.from(scanResult.available.keys());
  } else if (options.categories && options.categories.length > 0) {
    categories = options.categories.filter(c => scanResult.available.has(c));
    if (categories.length === 0) {
      console.log(chalk.yellow('None of the specified categories are available.'));
      console.log(chalk.gray('Available: ' + Array.from(scanResult.available.keys()).join(', ')));
      return;
    }
  } else if (process.stdout.isTTY) {
    // Interactive category selection via wizard
    const { showImportWizard } = await import('./ui/ImportWizard.js');
    await showImportWizard(registry, { ...options, source: options.source });
    return;
  } else {
    // Non-interactive: import all available
    categories = Array.from(scanResult.available.keys());
  }

  // Dry run
  if (options.dryRun) {
    console.log(chalk.cyan(`Dry run — ${importer.displayName}:`));
    printDryRun(scanResult.available, categories);
    return;
  }

  // Import
  console.log(chalk.cyan(`Importing from ${importer.displayName}...`));
  const result = await importer.import(categories, (progress) => {
    if (!process.stdout.isTTY) return; // Wizard handles TTY progress
    if (progress.status === 'done') {
      console.log(chalk.green(`  ✓ ${progress.category}: ${progress.current}/${progress.total}`));
    } else if (progress.status === 'failed') {
      console.log(chalk.red(`  ✗ ${progress.category}: ${progress.item} — ${progress.status}`));
    }
  });

  printSummary(result);
}

function printDryRun(
  available: Map<ImportCategory, { count: number; description: string }>,
  categories: ImportCategory[],
): void {
  for (const [cat, info] of available) {
    if (categories.includes(cat)) {
      console.log(chalk.white(`  ${cat}: ${info.count} items (${info.description})`));
    }
  }
}

function printSummary(result: ImportResult): void {
  console.log();
  console.log(chalk.bold(`Import complete from ${result.source}:`));

  for (const [cat, stats] of result.imported) {
    const icon = stats.failed > 0 ? chalk.yellow('⚠') : chalk.green('✓');
    const parts = [`${stats.success} imported`];
    if (stats.failed > 0) parts.push(`${stats.failed} failed`);
    if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
    console.log(`  ${icon} ${cat}: ${parts.join(', ')}`);

    // Show skip reasons when available
    if (stats.skipReasons && Object.keys(stats.skipReasons).length > 0) {
      for (const [reason, count] of Object.entries(stats.skipReasons)) {
        console.log(chalk.gray(`      ${count}× ${reason}`));
      }
    }
  }

  if (result.errors.length > 0) {
    console.log();
    console.log(chalk.yellow(`${result.errors.length} error(s):`));
    for (const err of result.errors.slice(0, 5)) {
      console.log(chalk.gray(`  - ${err.category}/${err.item}: ${err.error}`));
    }
    if (result.errors.length > 5) {
      console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
    }
  }

  console.log();
  console.log(chalk.cyan('Next steps:'));
  console.log(chalk.white('  /sessions     — Browse imported sessions'));
  console.log(chalk.white('  /resume       — Resume an imported session'));
  console.log(chalk.gray(`  Duration: ${(result.duration / 1000).toFixed(1)}s`));
}
