/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global test setup:
 * - Patches yoga-wasm-web/auto for asm.js compatibility (must run before Ink imports)
 * - Ensures i18n is initialized before any module-level t() calls
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fix yoga-wasm-web/auto node.js entry BEFORE any Ink import.
// The asm.js default export is a factory function that must be called,
// not re-exported directly. Without this, Yoga.Node.create() throws:
// "undefined is not an object (evaluating 'asm.Node.create')"
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const yogaNodeJs = path.join(__dirname, 'node_modules', 'yoga-wasm-web', 'dist', 'node.js');
if (fs.existsSync(yogaNodeJs)) {
  const content = fs.readFileSync(yogaNodeJs, 'utf8');
  if (content.includes('export { default } from "./asm.js"')) {
    fs.writeFileSync(yogaNodeJs, [
      '// Patched: use asm.js fallback instead of WASM for Bun binary compatibility.',
      '// asm.js default export is a function that must be called to get the yoga module.',
      'import asm from "./asm.js";',
      'export default asm();',
      'export * from "./wrapAsm-f766f97f.js";',
      '',
    ].join('\n'));
  }
}

import { initI18n } from './src/i18n/index.js';

await initI18n('en');
