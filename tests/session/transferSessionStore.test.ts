import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { importTransferSession } from '../../src/session/transfer/transfer-session-store.js';
import type { SessionTransfer } from '../../src/session/transfer/session-transfer.js';
vi.unmock('node:fs');
const roots: string[] = [];
const snapshot: SessionTransfer = { version: 1, source: 'web', sourceSessionId: 'source', title: 'Transferred chat', createdAt: '2026-09-08T00:00:00.000Z', provider: 'autohandai', model: 'fantail', repository: null,
  messages: [{ role: 'user', content: 'Continue the parser 🦆', createdAt: '2026-09-08T00:00:00.000Z' }, { role: 'assistant', content: 'Ready to continue.', createdAt: '2026-09-08T00:01:00.000Z' }] };
const transfer = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: 'personal_ada', expiresAt: '2026-09-09T00:00:00.000Z' };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
describe('transfer session index recovery', () => {
  it('recovers the session index after a dead importer leaves an old owner record', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transfer-session-')); roots.push(root);
    const directory = path.join(root, 'sessions'), lock = path.join(directory, 'index.json.lock');
    await fs.mkdir(lock, { recursive: true });
    const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await fs.writeFile(path.join(lock, `${ownerId}.owner`), JSON.stringify({ version: 1, ownerId, pid: 12345, createdAt: Date.now() - 600_000 }));
    const kill = process.kill.bind(process);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => { if (pid === 12345) { throw Object.assign(new Error('Process exited'), { code: 'ESRCH' }); } return kill(pid, signal); });
    await expect(importTransferSession(snapshot, transfer, root, directory)).resolves.toBe(`web-${transfer.id}`);
    await expect(fs.stat(lock)).rejects.toThrow();
  }, 15_000);
  it('keeps an old lock while its owning process is alive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transfer-session-')); roots.push(root);
    const directory = path.join(root, 'sessions'), lock = path.join(directory, 'index.json.lock');
    await fs.mkdir(lock, { recursive: true });
    const ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner = path.join(lock, `${ownerId}.owner`);
    await fs.writeFile(owner, JSON.stringify({ version: 1, ownerId, pid: process.pid, createdAt: Date.now() - 600_000 }));
    const pending = importTransferSession(snapshot, transfer, root, directory);
    await new Promise(resolve => setTimeout(resolve, 75));
    try {
      expect((await fs.stat(owner)).isFile()).toBe(true);
      await expect(fs.stat(path.join(directory, `web-${transfer.id}`))).rejects.toThrow();
    } finally { await fs.unlink(owner); await fs.rmdir(lock); }
    await expect(pending).resolves.toBe(`web-${transfer.id}`);
  });
});
