#!/usr/bin/env node
/**
 * Fix yoga-wasm-web/auto entry point for Bun binary compatibility.
 *
 * The original node.js entry from npm loads yoga via WASM:
 *   let Yoga = await a(await readFile(require.resolve("./yoga.wasm")));
 *
 * This breaks in Bun compiled binaries because:
 * 1. The .wasm file isn't embedded in the compiled binary
 * 2. readFile/createRequire can't resolve paths inside Bun's virtual FS
 *
 * A previous patch re-exported the asm.js default directly:
 *   export { default } from "./asm.js";
 * But asm.js exports a factory FUNCTION that must be called first.
 *
 * The fix: import the asm.js factory, call it, and export the result.
 * This uses pure JS (no WASM) and works in all environments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeJsPath = path.join(__dirname, '..', 'node_modules', 'yoga-wasm-web', 'dist', 'node.js');

if (!fs.existsSync(nodeJsPath)) {
  console.log('yoga-wasm-web not found, skipping fix.');
  process.exit(0);
}

const current = fs.readFileSync(nodeJsPath, 'utf8');

// Already patched correctly
if (current.includes('export default asm()')) {
  console.log('yoga-wasm-web/auto already fixed.');
  process.exit(0);
}

const fixed = `// Patched: use asm.js fallback instead of WASM for Bun binary compatibility.
// The asm.js default export is a factory function that must be called to get the yoga module.
import asm from "./asm.js";
export default asm();
export * from "./wrapAsm-f766f97f.js";
`;

// Detect patterns that need patching:
// 1. Original npm content: WASM loader with readFile("./yoga.wasm")
// 2. Old broken patch: re-exports asm.js default without calling it
const needsPatch =
  current.includes('yoga.wasm') ||
  current.includes('export { default } from "./asm.js"');

if (needsPatch) {
  fs.writeFileSync(nodeJsPath, fixed);
  console.log('Fixed: yoga-wasm-web/auto node.js → asm.js fallback (asm() called, not re-exported)');
} else {
  console.log('yoga-wasm-web/auto node.js has unexpected content, skipping fix.');
  console.log('Content preview:', current.substring(0, 200));
}
