/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, render, type Instance } from 'ink';
import Spinner from 'ink-spinner';
import { I18nProvider } from '../../ui/i18n/index.js';
import { showModal } from '../../ui/ink/components/Modal.js';
import { showCategorySelector, CATEGORY_LABELS } from './CategorySelector.js';
import { ImportProgressView } from './ImportProgress.js';
import type { ImporterRegistry } from '../registry.js';
import type {
  ImportCategory,
  ImportError,
  ImportOptions,
  ImportProgress,
  ImportResult,
  ImportScanResult,
  Importer,
} from '../types.js';
import type { CategoryProgress } from './ImportProgress.js';

// ---------------------------------------------------------------
// Unmount helper
// ---------------------------------------------------------------

function unmountAndResolve<T>(
  instance: Instance,
  value: T,
  resolve: (value: T) => void,
): void {
  instance.unmount();
  process.nextTick(() => resolve(value));
}

// ---------------------------------------------------------------
// Loading spinner sub-component
// ---------------------------------------------------------------

function ScanningSpinner({ source }: { source: string }) {
  return (
    <Box paddingX={1}>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> Scanning {source}...</Text>
    </Box>
  );
}

// ---------------------------------------------------------------
// Import summary sub-component
// ---------------------------------------------------------------

interface ImportSummaryProps {
  source: string;
  result: ImportResult;
}

function ImportSummary({ source, result }: ImportSummaryProps) {
  const entries = Array.from(result.imported.entries());

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green">{'\u2713'} Import complete from {source}</Text>
      <Text>{''}</Text>

      {entries.map(([cat, stats]) => {
        const label = (CATEGORY_LABELS[cat] ?? cat).padEnd(12);
        const parts: string[] = [];
        if (stats.success > 0) parts.push(`${stats.success} imported`);
        if (stats.failed > 0) parts.push(`${stats.failed} failed`);
        if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);

        return (
          <Text key={cat}>
            {'  '}{label}: {parts.join(', ') || 'none'}
          </Text>
        );
      })}

      <Text>{''}</Text>
      <Text color="cyan">Next steps:</Text>
      <Text>  /sessions     {'\u2014'} Browse your imported sessions</Text>
      <Text>  /resume       {'\u2014'} Resume an imported session</Text>
    </Box>
  );
}

// ---------------------------------------------------------------
// Live progress wrapper (rendered via Ink)
// ---------------------------------------------------------------

interface LiveProgressProps {
  importer: Importer;
  categories: ImportCategory[];
  onComplete: (result: ImportResult) => void;
}

function LiveProgress({ importer, categories, onComplete }: LiveProgressProps) {
  const [progress, setProgress] = useState<Map<ImportCategory, CategoryProgress>>(
    () => {
      const initial = new Map<ImportCategory, CategoryProgress>();
      for (const cat of categories) {
        initial.set(cat, { current: 0, total: 0, item: '', status: 'importing' });
      }
      return initial;
    },
  );
  const [errors, setErrors] = useState<ImportError[]>([]);

  const handleProgress = useCallback((p: ImportProgress) => {
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(p.category, {
        current: p.current,
        total: p.total,
        item: p.item,
        status: p.status,
      });
      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    importer.import(categories, handleProgress).then((result) => {
      if (!mounted) return;
      setErrors(result.errors);

      // Update all progress entries to final states
      const finalProgress = new Map<ImportCategory, CategoryProgress>();
      for (const [cat, stats] of result.imported.entries()) {
        const status = stats.failed > 0 ? 'failed' as const : 'done' as const;
        finalProgress.set(cat, {
          current: stats.success + stats.skipped,
          total: stats.success + stats.failed + stats.skipped,
          item: '',
          status,
        });
      }
      setProgress(finalProgress);

      // Notify parent after a brief pause so the user can see final state
      setTimeout(() => {
        if (mounted) onComplete(result);
      }, 500);
    });

    return () => {
      mounted = false;
    };
  }, [importer, categories, handleProgress, onComplete]);

  return <ImportProgressView progress={progress} errors={errors} />;
}

// ---------------------------------------------------------------
// Public orchestrator
// ---------------------------------------------------------------

/**
 * Runs the full interactive import wizard flow:
 *
 * 1. Detect available sources
 * 2. Let the user pick one (or use the pre-selected source from options)
 * 3. Scan the selected source for importable data
 * 4. Let the user pick categories via checkbox selector
 * 5. Run the import with live progress
 * 6. Show a summary with next-step suggestions
 */
export async function showImportWizard(
  registry: ImporterRegistry,
  options: ImportOptions,
): Promise<void> {
  // ------- Step 1: Detect available sources -------
  const available = await registry.detectAvailable();

  if (available.length === 0) {
    console.log('\nNo supported agent data found on this machine.\n');
    return;
  }

  // ------- Step 2: Source selection -------
  let importer: Importer | undefined;

  if (options.source) {
    importer = registry.get(options.source);
    if (!importer) {
      console.log(`\nUnknown import source: ${options.source}\n`);
      return;
    }
    const exists = await importer.detect();
    if (!exists) {
      console.log(`\n${importer.displayName} data not found at ${importer.homePath}\n`);
      return;
    }
  } else if (available.length === 1) {
    importer = available[0]!;
  } else {
    const modalOptions = available.map((imp) => ({
      label: imp.displayName,
      value: imp.name,
    }));

    const selected = await showModal({
      title: 'Select a source to import from:',
      options: modalOptions,
    });

    if (!selected) return; // user cancelled

    importer = registry.get(selected.value as any);
    if (!importer) return;
  }

  // ------- Step 3: Scan the source -------
  let scanResult: ImportScanResult;

  if (process.stdout.isTTY) {
    // Show scanning spinner
    scanResult = await new Promise<ImportScanResult>((resolve) => {
      const inst = render(
        <I18nProvider>
          <ScanningSpinner source={importer!.displayName} />
        </I18nProvider>,
        { exitOnCtrlC: false },
      );

      importer!.scan().then((result) => {
        inst.unmount();
        process.nextTick(() => resolve(result));
      });
    });
  } else {
    scanResult = await importer.scan();
  }

  if (scanResult.available.size === 0) {
    console.log(`\nNo importable data found in ${importer.displayName}.\n`);
    return;
  }

  // ------- Step 4: Category selection -------
  let selectedCategories: ImportCategory[];

  if (options.all || options.categories) {
    selectedCategories = options.categories
      ?? Array.from(scanResult.available.keys());
  } else {
    const picked = await showCategorySelector(scanResult.available);
    if (!picked || picked.length === 0) return; // user cancelled
    selectedCategories = picked;
  }

  // ------- Step 5: Run import with live progress -------
  if (options.dryRun) {
    console.log('\nDry run — would import the following categories:');
    for (const cat of selectedCategories) {
      const info = scanResult.available.get(cat);
      const label = CATEGORY_LABELS[cat] ?? cat;
      console.log(`  ${label}: ${info?.description ?? 'unknown'}`);
    }
    console.log('');
    return;
  }

  const result = await new Promise<ImportResult>((resolve) => {
    if (!process.stdout.isTTY) {
      // Non-interactive: just run
      importer!.import(selectedCategories).then(resolve);
      return;
    }

    let completed = false;
    const inst = render(
      <I18nProvider>
        <LiveProgress
          importer={importer!}
          categories={selectedCategories}
          onComplete={(res) => {
            if (completed) return;
            completed = true;
            unmountAndResolve(inst, res, resolve);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false },
    );
  });

  // ------- Step 6: Summary -------
  if (process.stdout.isTTY) {
    const summaryInst = render(
      <I18nProvider>
        <ImportSummary source={importer.displayName} result={result} />
      </I18nProvider>,
      { exitOnCtrlC: false },
    );
    // Give Ink a moment to flush then unmount
    await new Promise<void>((r) => setTimeout(r, 100));
    summaryInst.unmount();
  } else {
    console.log(`\nImport complete from ${importer.displayName}`);
    for (const [cat, stats] of result.imported.entries()) {
      const label = CATEGORY_LABELS[cat] ?? cat;
      console.log(`  ${label}: ${stats.success} imported, ${stats.failed} failed`);
    }
    console.log('');
  }
}
