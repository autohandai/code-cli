#!/usr/bin/env node
/**
 * Fix ansi-styles version mismatch in ink dependencies.
 *
 * Bun doesn't support nested overrides, so we need to manually ensure
 * that ink's dependencies use the correct ansi-styles version (v6.x).
 *
 * The issue: slice-ansi@6.x and wrap-ansi@8.x require ansi-styles@^6.x,
 * but they might pick up the top-level ansi-styles@4.x instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.join(__dirname, '..', 'node_modules');

// Paths that need ansi-styles@6.x but might pick up v4.x
const pathsToFix = [
  'ink/node_modules/slice-ansi',
  'ink/node_modules/wrap-ansi',
  'ink/node_modules/cli-truncate/node_modules/slice-ansi',
];

// Source of correct ansi-styles v6
const ansiStylesV6Source = path.join(nodeModules, 'slice-ansi', 'node_modules', 'ansi-styles');

// Check if source exists
if (!fs.existsSync(ansiStylesV6Source)) {
  console.log('ansi-styles v6 source not found at:', ansiStylesV6Source);
  console.log('This might not be needed or dependencies have changed.');
  process.exit(0);
}

// Fix each path
for (const relPath of pathsToFix) {
  const targetParent = path.join(nodeModules, relPath);

  if (!fs.existsSync(targetParent)) {
    continue;
  }

  const targetModules = path.join(targetParent, 'node_modules');
  const targetAnsiStyles = path.join(targetModules, 'ansi-styles');

  // Check if ansi-styles already exists and is v6
  if (fs.existsSync(targetAnsiStyles)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(targetAnsiStyles, 'package.json'), 'utf8'));
      if (pkg.version.startsWith('6.')) {
        continue; // Already correct version
      }
    } catch {
      // Continue to fix
    }
  }

  // Create node_modules directory if needed
  if (!fs.existsSync(targetModules)) {
    fs.mkdirSync(targetModules, { recursive: true });
  }

  // Remove existing symlink or directory
  if (fs.existsSync(targetAnsiStyles)) {
    fs.rmSync(targetAnsiStyles, { recursive: true, force: true });
  }

  // Create symlink
  try {
    const relativePath = path.relative(targetModules, ansiStylesV6Source);
    fs.symlinkSync(relativePath, targetAnsiStyles);
    console.log(`Fixed: ${relPath}/node_modules/ansi-styles -> ${relativePath}`);
  } catch (err) {
    console.error(`Failed to fix ${relPath}:`, err.message);
  }
}

console.log('ansi-styles fix complete.');
