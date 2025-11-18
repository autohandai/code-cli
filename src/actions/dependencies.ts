/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';

export interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readPackageManifest(cwd: string): Promise<PackageManifest | null> {
  const manifestPath = path.join(cwd, 'package.json');
  if (!(await fs.pathExists(manifestPath))) {
    return null;
  }
  return fs.readJson(manifestPath) as Promise<PackageManifest>;
}

export async function addDependency(
  cwd: string,
  name: string,
  version: string,
  options: { dev?: boolean } = {}
): Promise<void> {
  const manifest = (await readPackageManifest(cwd)) ?? {};
  if (options.dev) {
    manifest.devDependencies = manifest.devDependencies ?? {};
    manifest.devDependencies[name] = version;
  } else {
    manifest.dependencies = manifest.dependencies ?? {};
    manifest.dependencies[name] = version;
  }
  const manifestPath = path.join(cwd, 'package.json');
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
}

export async function removeDependency(
  cwd: string,
  name: string,
  options: { dev?: boolean } = {}
): Promise<void> {
  const manifest = (await readPackageManifest(cwd)) ?? {};
  const targetKey = options.dev ? 'devDependencies' : 'dependencies';
  if (manifest[targetKey] && manifest[targetKey]![name]) {
    delete manifest[targetKey]![name];
    const manifestPath = path.join(cwd, 'package.json');
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  }
}
