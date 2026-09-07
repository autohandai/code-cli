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
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    // Replace the inode so Bun's shared package-cache hardlinks remain untouched.
    const { mode } = await stat(file);
    await writeFile(temporaryFile, patched, { flag: 'wx', mode: mode & 0o777 });
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}
