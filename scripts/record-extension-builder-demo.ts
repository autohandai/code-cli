/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { recordExtensionBuilderDemo } from '../src/testing/scenarios/recordExtensionBuilderDemo.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const output = await recordExtensionBuilderDemo({
  repoRoot,
  castPath: path.join(repoRoot, 'docs', 'video', 'extension-builder-demo.cast'),
  gifPath: path.join(repoRoot, 'docs', 'gif', 'extension-builder-demo.gif'),
  mp4Path: path.join(repoRoot, 'docs', 'video', 'extension-builder-demo.mp4'),
});

process.stdout.write([
  'Recorded the extension-builder demo with Tuistory:',
  `- ${path.relative(repoRoot, output.castPath)}`,
  `- ${path.relative(repoRoot, output.gifPath)}`,
  `- ${path.relative(repoRoot, output.mp4Path)}`,
  '',
].join('\n'));
