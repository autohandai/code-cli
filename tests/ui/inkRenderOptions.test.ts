/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createScrollbackPreservingOutput, inkRenderOptions } from '../../src/ui/inkRenderOptions.js';

const SOURCE_ROOT = path.join(process.cwd(), 'src');
const UNSUPPORTED_INK_RENDER_OPTIONS = ['concurrent', 'alternateScreen', 'maxFps'] as const;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    if (entry.isFile() && /\.(tsx?|jsx?)$/u.test(entry.name)) {
      return [fullPath];
    }
    return [];
  }));

  return files.flat();
}

describe('Ink 7 render options', () => {
  it('keeps scrollback intact when Ink clears an overflowing startup frame', async () => {
    const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
    let received = '';
    output.on('data', (chunk: Buffer) => { received += chunk.toString(); });
    const protectedOutput = createScrollbackPreservingOutput(output);
    const flushed = vi.fn();
    expect(protectedOutput.write('\x1b[2J\x1b[3J\x1b[Hlogo', 'utf8', flushed)).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(received).toBe('\x1b[2J\x1b[Hlogo');
    expect(flushed).toHaveBeenCalledOnce();
    protectedOutput.write(Buffer.from(' next'));
    expect(received).toBe('\x1b[2J\x1b[Hlogo next');
    output.destroy();
  });

  it('forwards current terminal dimensions and resize listener cleanup to the real output', () => {
    const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
    Object.assign(output, { columns: 80, rows: 24, isTTY: true });
    const protectedOutput = createScrollbackPreservingOutput(output);
    const resize = vi.fn();
    protectedOutput.on('resize', resize);
    output.columns = 26;
    output.emit('resize');
    expect(protectedOutput.columns).toBe(26);
    expect(resize).toHaveBeenCalledOnce();
    protectedOutput.off('resize', resize);
    expect(output.listenerCount('resize')).toBe(0);
    output.destroy();
  });

  it('returns only Ink-supported render options', () => {
    expect(inkRenderOptions({})).toEqual({});
    expect(inkRenderOptions({ exitOnCtrlC: false })).toEqual({ exitOnCtrlC: false });
  });

  it('does not pass unsupported render options to Ink', async () => {
    const sourceFiles = await collectSourceFiles(SOURCE_ROOT);
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const body = await readFile(file, 'utf8');
      for (const option of UNSUPPORTED_INK_RENDER_OPTIONS) {
        const optionPropertyPattern = new RegExp(`(?<![\\w$])${option}\\s*:`, 'u');
        if (optionPropertyPattern.test(body)) {
          violations.push(`${path.relative(process.cwd(), file)} uses ${option}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
