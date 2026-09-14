/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.fn<(file: string) => Promise<string>>();
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: (file: string) => readFile(file),
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const procError = (code: string) => Object.assign(new Error(`${code}: read`), { code, syscall: 'read' });

describe('capturePeerProcess on Linux', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    vi.resetModules();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    readFile.mockReset();
  });

  it.each(['ESRCH', 'ENOENT'])('reports a process whose /proc entry fails with %s as already gone', async (code) => {
    // A short-lived child can exit between spawn and capture; the kernel then
    // answers ENOENT for a reaped entry or ESRCH for one still being torn down.
    readFile.mockImplementation(async (file) => {
      if (file === '/proc/sys/kernel/random/boot_id') return 'boot-id\n';
      throw procError(code);
    });
    const { capturePeerProcess } = await import('../../../src/session/peers/PeerProcessIdentity.js');
    await expect(capturePeerProcess(4242)).resolves.toBeUndefined();
  });

  it('still surfaces unrelated /proc failures', async () => {
    readFile.mockImplementation(async (file) => {
      if (file === '/proc/sys/kernel/random/boot_id') return 'boot-id\n';
      throw procError('EACCES');
    });
    const { capturePeerProcess } = await import('../../../src/session/peers/PeerProcessIdentity.js');
    await expect(capturePeerProcess(4242)).rejects.toMatchObject({ code: 'EACCES' });
  });
});
