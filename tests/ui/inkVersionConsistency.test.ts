/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';

/**
 * Regression guard for the "composer renders twice" bug.
 *
 * The Ink rendering pipeline (Static commits, frame-erase, cursor handling)
 * changes incompatibly across major versions. The source under src/ui/ink is
 * written against the Ink/React majors declared in package.json. When the
 * installed node_modules is stale (e.g. an `npm install` against the old
 * package-lock.json left Ink 4.4.1 + React 18 in place while the source and
 * bun.lock target Ink 7 + React 19), the Ink-7-targeted code runs against the
 * wrong renderer and the composer stacks/duplicates on screen.
 *
 * These tests fail loudly when the installed dependency majors drift from what
 * package.json declares, so the mismatch is caught before it reaches a terminal.
 */
const ROOT = process.cwd();

// Read package.json files directly from disk. Ink 7 restricts its "exports"
// map, so module resolution of "ink/package.json" is blocked — but the file is
// always present in the (hoisted) node_modules entry, so read it by path.
function readInstalledManifest(name: 'ink' | 'react'): { version: string; peerDependencies?: Record<string, string> } {
  const pkgPath = path.join(ROOT, 'node_modules', name, 'package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

function declaredRange(name: 'ink' | 'react'): string {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const range = pkg.dependencies?.[name];
  expect(range, `package.json must declare a "${name}" dependency`).toBeTruthy();
  return range as string;
}

function installedVersion(name: 'ink' | 'react'): string {
  return readInstalledManifest(name).version;
}

describe('Ink/React installed version consistency', () => {
  it('installed ink satisfies the range declared in package.json', () => {
    const range = declaredRange('ink');
    const installed = installedVersion('ink');

    expect(
      semver.satisfies(installed, range),
      `Installed ink@${installed} does not satisfy declared range "${range}". ` +
        `node_modules is out of sync with bun.lock — run "bun install". ` +
        `A stale Ink major breaks the composer renderer (renders twice).`
    ).toBe(true);
  });

  it('installed react satisfies the range declared in package.json', () => {
    const range = declaredRange('react');
    const installed = installedVersion('react');

    expect(
      semver.satisfies(installed, range),
      `Installed react@${installed} does not satisfy declared range "${range}". ` +
        `node_modules is out of sync with bun.lock — run "bun install". ` +
        `Ink 7 requires React 19; running it against React 18 corrupts rendering.`
    ).toBe(true);
  });

  it('installed ink major matches ink peerDependency on react major', () => {
    // Ink declares the React major it is built for via peerDependencies.
    // If the installed React major falls outside that, the reconciler mismatch
    // is exactly what produces the duplicate-composer corruption.
    const inkPkg = readInstalledManifest('ink');
    const reactPeer = inkPkg.peerDependencies?.react as string | undefined;
    expect(reactPeer, 'ink must declare a react peerDependency').toBeTruthy();

    const installedReact = installedVersion('react');
    expect(
      semver.satisfies(installedReact, reactPeer as string),
      `Installed react@${installedReact} does not satisfy ink's react peer range "${reactPeer}". ` +
        `Reinstall dependencies with "bun install".`
    ).toBe(true);
  });

  it('installed ink exports cursor layout hooks used by the composer', async () => {
    const inkRuntime = (await import('ink')) as Record<string, unknown>;

    expect(
      typeof inkRuntime.useBoxMetrics,
      'Installed ink must export useBoxMetrics for composer cursor placement. Reinstall dependencies with "bun install".'
    ).toBe('function');
    expect(
      typeof inkRuntime.useCursor,
      'Installed ink must export useCursor for composer cursor placement. Reinstall dependencies with "bun install".'
    ).toBe('function');
  });
});
