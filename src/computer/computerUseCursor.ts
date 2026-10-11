import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { COMPUTER_USE_CURSOR_THEME } from '../generated/computerUseCursorTheme.js';

export const COMPUTER_USE_CURSOR_THEME_ID = 'autohand.light-gray';
export const DEFAULT_COMPUTER_USE_CURSOR = { theme_id: COMPUTER_USE_CURSOR_THEME_ID, reduced_motion: 'auto' } as const;

export function computerUseCursorMotion(override?: string): { glide_duration_ms: number } {
  const glide = override?.trim() ? Number(override) : 50;
  if (!Number.isInteger(glide) || glide < 0 || glide > 5000) {
    throw new Error('AUTOHAND_COMPUTER_USE_GLIDE_MS must be an integer from 0 to 5000.');
  }
  return { glide_duration_ms: glide };
}

export async function installComputerUseCursor(directory: string): Promise<void> {
  const bytes = Buffer.from(COMPUTER_USE_CURSOR_THEME, 'base64');
  const target = path.join(directory, `${COMPUTER_USE_CURSOR_THEME_ID}.cua-theme`);
  try {
    if ((await readFile(target)).equals(bytes)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
