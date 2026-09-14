import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const inkRoot = dirname(dirname(require.resolve('ink')));
const { version } = JSON.parse(await readFile(join(inkRoot, 'package.json'), 'utf8'));
if (version !== '7.1.1') {
  throw new Error(`Ink cursor repair requires 7.1.1; found ${version}. Revalidate the repair before changing Ink.`);
}

const file = join(inkRoot, 'build', 'log-update.js');
const source = await readFile(file, 'utf8');
const marker = '// Autohand: retain cursor intent until useCursor updates it or unmounts.';
const transientCursor = 'cursorDirty ? cursorPosition : undefined';
const count = (text, fragment) => text.split(fragment).length - 1;

// Replace a file's contents through a fresh inode so Bun's shared
// package-cache hardlinks remain untouched.
async function replaceFile(target, contents) {
  const temporaryFile = `${target}.${randomUUID()}.tmp`;
  try {
    const { mode } = await stat(target);
    await writeFile(temporaryFile, contents, { flag: 'wx', mode: mode & 0o777 });
    await rename(temporaryFile, target);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

// Ink 7.1.1 clears the screen and scrollback, then rewrites every line, on
// each React commit while the frame is taller than the viewport, even when
// nothing changed. Skip that path when neither the frame, the static output
// nor the cursor moved. Falling through to the throttled log instead would
// hide the caret: log-update's first render() hides it and, with nothing to
// draw, never shows it again.
const rendererFile = join(inkRoot, 'build', 'ink.js');
const rendererSource = await readFile(rendererFile, 'utf8');
const overflowMarker = '// Autohand: repaint an overflowing frame only when it or the cursor moved.';
const overflowBranch = '        if (shouldClearTerminal) {\n';
const guardedOverflowBranch = `        ${overflowMarker}\n        if (shouldClearTerminal && !hasStaticOutput && !this.log.willRender(outputToRender)) {\n            return;\n        }\n${overflowBranch}`;
if (rendererSource.includes(overflowMarker)) {
  if (count(rendererSource, guardedOverflowBranch) !== 1 || count(rendererSource, overflowBranch) !== 1) {
    throw new Error('Ink overflow repair found an incomplete patch. Reinstall Ink 7.1.1.');
  }
} else {
  if (count(rendererSource, overflowBranch) !== 1
    || !rendererSource.includes("const hasStaticOutput = staticOutput !== '';")) {
    throw new Error('Ink overflow repair found an unexpected renderer. Revalidate the patch before installing.');
  }
  await replaceFile(rendererFile, rendererSource.replace(overflowBranch, guardedOverflowBranch));
}

if (source.startsWith(marker)) {
  if (source.includes(transientCursor)
    || count(source, 'const getActiveCursor = () => (cursorPosition);') !== 2
    || count(source, 'const activeCursor = cursorPosition;') !== 2) {
    throw new Error('Ink cursor repair found an incomplete patch. Reinstall Ink 7.1.1.');
  }
} else {
  if (count(source, transientCursor) !== 4
    || count(source, `const getActiveCursor = () => (${transientCursor});`) !== 2
    || count(source, `const activeCursor = ${transientCursor};`) !== 2) {
    throw new Error('Ink cursor repair found an unexpected renderer. Revalidate the patch before installing.');
  }

  const patched = `${marker}\n${source.replaceAll(transientCursor, 'cursorPosition').replaceAll(
    '// Only use cursor if setCursorPosition was called since last render.\n        // This ensures stale positions don\'t persist after component unmount.',
    '// useCursor explicitly clears its position on disable and unmount.',
  )}`;
  await replaceFile(file, patched);
}
