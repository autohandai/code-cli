#!/usr/bin/env node
/**
 * Patch ink dependencies for Bun compiled binary compatibility.
 *
 * Two issues prevent ink from working inside `bun build --compile` binaries:
 *
 * 1. react-devtools-core — ink's devtools.js imports it statically.
 *    Even behind a DEV=true guard, Bun resolves all imports eagerly.
 *    Fix: replace devtools.js with an empty module.
 *
 * 2. yoga.wasm — yoga-wasm-web/auto → node.js loads yoga.wasm via
 *    readFile(createRequire(import.meta.url).resolve("./yoga.wasm")).
 *    Inside /$bunfs/root/..., the WASM file doesn't exist.
 *    Fix: redirect node.js to re-export the pure JS asm.js fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.join(__dirname, '..', 'node_modules');

// --- Patch 1: Stub out ink/build/devtools.js ---
const devtoolsPath = path.join(nodeModules, 'ink', 'build', 'devtools.js');
if (fs.existsSync(devtoolsPath)) {
  const content = fs.readFileSync(devtoolsPath, 'utf8');
  if (content.includes('react-devtools-core')) {
    fs.writeFileSync(devtoolsPath, '// Stubbed — react-devtools-core not needed at runtime.\n');
    console.log('Patched ink/build/devtools.js (removed react-devtools-core import).');
  }
}

// --- Patch 2: Redirect yoga-wasm-web/auto to use asm.js instead of WASM ---
const yogaNodePath = path.join(nodeModules, 'yoga-wasm-web', 'dist', 'node.js');
if (fs.existsSync(yogaNodePath)) {
  const content = fs.readFileSync(yogaNodePath, 'utf8');
  if (content.includes('yoga.wasm')) {
    const asmReExport = [
      '// Patched: use asm.js fallback instead of WASM for Bun binary compatibility.',
      'export { default } from "./asm.js";',
      'export * from "./wrapAsm-f766f97f.js";',
      '',
    ].join('\n');
    fs.writeFileSync(yogaNodePath, asmReExport);
    console.log('Patched yoga-wasm-web/dist/node.js (using asm.js fallback).');
  }
}
