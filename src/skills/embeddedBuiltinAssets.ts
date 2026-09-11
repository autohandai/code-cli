/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_HOME } from '../constants.js';
import { BUILTIN_ASSETS, BUILTIN_ASSETS_DIGEST } from '../generated/builtinAssets.js';

export type BuiltinAssetKind = 'skills' | 'agents';

export interface EmbeddedBuiltinAssetsOptions {
  /** Where materialized copies live; defaults to `<AUTOHAND_HOME>/builtin`. */
  root?: string;
  assets?: Readonly<Record<string, string>>;
  digest?: string;
}

/**
 * Compiled binaries have no `skills/builtin` or `agents/builtin` directory
 * beside the module, so the files embedded at build time are written under
 * the Autohand home, keyed by their content digest. A finished copy is
 * reused; a new build with different content gets its own directory.
 */
export async function materializeEmbeddedBuiltinAssets(
  options: EmbeddedBuiltinAssetsOptions = {},
): Promise<string> {
  const root = options.root ?? path.join(AUTOHAND_HOME, 'builtin');
  const assets = options.assets ?? BUILTIN_ASSETS;
  const digest = options.digest ?? BUILTIN_ASSETS_DIGEST;
  const target = path.join(root, digest);

  if (await fse.pathExists(target)) {
    return target;
  }

  const staging = `${target}.partial-${process.pid}-${Date.now()}`;
  try {
    for (const [relativePath, content] of Object.entries(assets)) {
      await fse.outputFile(path.join(staging, ...relativePath.split('/')), content, 'utf8');
    }
    await fse.move(staging, target, { overwrite: false });
  } catch (error) {
    await fse.remove(staging).catch(() => undefined);
    // Another process finished the same digest first; its copy is identical.
    if (!(await fse.pathExists(target))) {
      throw error;
    }
  }
  return target;
}

export async function resolveEmbeddedBuiltinAssetDirectory(
  kind: BuiltinAssetKind,
  options: EmbeddedBuiltinAssetsOptions = {},
): Promise<string> {
  const target = await materializeEmbeddedBuiltinAssets(options);
  return path.join(target, kind, 'builtin');
}
