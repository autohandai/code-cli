/**
 * Remembers whether Axo is out between sessions, in `~/.autohand/axo.json`.
 * Not in config.json: that file is synced and listed by `/settings`, and Axo is a secret.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTOHAND_FILES } from '../../constants.js';

export function readAxoEnabled(file: string = AUTOHAND_FILES.axoState): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && (parsed as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

/** Best effort: a failed write only means Axo forgets after a restart. */
export async function writeAxoEnabled(enabled: boolean, file: string = AUTOHAND_FILES.axoState): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ enabled })}\n`, 'utf8');
  } catch {
    // Ignore: persistence is a nicety for an easter egg.
  }
}
