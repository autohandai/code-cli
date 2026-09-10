import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { applyTransferPatch, captureTransferRepository, createTransferCheckout } from '../../src/session/transfer/transfer-workspace.js';

vi.unmock('node:child_process');
vi.unmock('node:fs');

const execute = promisify(execFile); const roots: string[] = [];
async function git(cwd: string, ...args: string[]): Promise<string> { return (await execute('git', args, { cwd })).stdout; }
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transfer-workspace-test-')); roots.push(root);
  await git(root, 'init'); await git(root, 'config', 'user.email', 'test@autohand.test'); await git(root, 'config', 'user.name', 'Test');
  await git(root, 'remote', 'add', 'origin', 'https://github.com/autohandai/fixture');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'base\n'); await fs.writeFile(path.join(root, '.gitignore'), 'secret.txt\n');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'base');
  await git(root, 'update-ref', 'refs/remotes/origin/main', (await git(root, 'rev-parse', 'HEAD')).trim());
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('repository handoff', () => {
  it('carries unpublished commits, staged/unstaged files, and untracked files while retaining the original index and worktree', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'committed.txt'), 'local commit\n'); await git(root, 'add', '.'); await git(root, 'commit', '-m', 'unpublished');
    await fs.writeFile(path.join(root, 'tracked.txt'), 'staged\n'); await git(root, 'add', 'tracked.txt');
    await fs.writeFile(path.join(root, 'tracked.txt'), 'unstaged\n'); await fs.writeFile(path.join(root, 'new.txt'), 'new file 🦆\n');
    await fs.writeFile(path.join(root, 'secret.txt'), 'do not transfer');
    const status = await git(root, 'status', '--porcelain'); const index = await fs.readFile(path.join(root, '.git/index'));
    const snapshot = await captureTransferRepository(root);
    expect(snapshot).not.toBeNull(); expect(snapshot!.patch).not.toContain('secret.txt');
    expect(await git(root, 'status', '--porcelain')).toBe(status); expect(await fs.readFile(path.join(root, '.git/index'))).toEqual(index);
    const destination = path.join(root, 'received');
    await createTransferCheckout(snapshot!, destination, root); await applyTransferPatch(snapshot!, destination);
    expect(await fs.readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('unstaged\n');
    expect(await fs.readFile(path.join(destination, 'committed.txt'), 'utf8')).toBe('local commit\n');
    expect(await fs.readFile(path.join(destination, 'new.txt'), 'utf8')).toBe('new file 🦆\n');
    await expect(fs.stat(path.join(destination, 'secret.txt'))).rejects.toThrow();
  });
  it('refuses to overwrite a destination or apply onto unrelated edits', async () => {
    const root = await fixture(); await fs.writeFile(path.join(root, 'tracked.txt'), 'changed\n');
    const snapshot = (await captureTransferRepository(root))!;
    await expect(createTransferCheckout(snapshot, root, root)).rejects.toThrow('new directory');
    const destination = path.join(root, 'received'); await createTransferCheckout(snapshot, destination, root);
    await fs.writeFile(path.join(destination, 'own.txt'), 'keep my edits');
    await expect(applyTransferPatch(snapshot, destination)).rejects.toThrow('destination changed');
    expect(await fs.readFile(path.join(destination, 'own.txt'), 'utf8')).toBe('keep my edits');
    expect(await fs.readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('base\n');
  });
  it('preserves the source branch and resumes an owned checkout without applying a patch twice', async () => {
    const root = await fixture(); await git(root, 'checkout', '-b', 'feature/parser');
    await fs.writeFile(path.join(root, 'tracked.txt'), 'transferred\n');
    const snapshot = (await captureTransferRepository(root))!;
    const destination = path.join(root, 'received');
    await createTransferCheckout(snapshot, destination, root);
    expect((await git(destination, 'branch', '--show-current')).trim()).toBe('feature/parser');
    await expect(createTransferCheckout(snapshot, destination, root)).resolves.toBe(destination);
    await applyTransferPatch(snapshot, destination);
    await fs.writeFile(path.join(destination, 'tracked.txt'), 'later work\n');
    await expect(createTransferCheckout(snapshot, destination, root)).resolves.toBe(destination);
    await expect(applyTransferPatch(snapshot, destination)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('later work\n');
    const nextTransfer = await captureTransferRepository(destination);
    expect(nextTransfer?.branch).toBe('feature/parser');
    expect(nextTransfer?.revision).toBe(snapshot.revision);
    expect(nextTransfer?.patch).toContain('+later work');
    await expect(createTransferCheckout({ ...snapshot, patch: snapshot.patch + '\n' }, destination, root)).rejects.toThrow('different transfer');
  });
  it('recognizes a patch applied before an interrupted completion record was saved', async () => {
    const root = await fixture(); await fs.writeFile(path.join(root, 'tracked.txt'), 'transferred\n');
    const snapshot = (await captureTransferRepository(root))!;
    const destination = path.join(root, 'received');
    await createTransferCheckout(snapshot, destination, root);
    const patch = path.join(root, 'fixture.patch'); await fs.writeFile(patch, snapshot.patch);
    await git(destination, 'apply', patch);
    await expect(applyTransferPatch(snapshot, destination)).resolves.toBeUndefined();
    expect(await fs.readFile(path.join(destination, 'tracked.txt'), 'utf8')).toBe('transferred\n');
  });
  it('retries checkout preparation after a source repository becomes available again', async () => {
    const root = await fixture(); const snapshot = (await captureTransferRepository(root))!;
    const destination = path.join(root, 'received');
    await git(root, 'remote', 'set-url', 'origin', 'https://github.com/autohandai/wrong');
    await expect(createTransferCheckout(snapshot, destination, root)).rejects.toThrow('transferred repository');
    await git(root, 'remote', 'set-url', 'origin', snapshot.url);
    await expect(createTransferCheckout(snapshot, destination, root)).resolves.toBe(destination);
    expect((await git(destination, 'rev-parse', 'HEAD')).trim()).toBe(snapshot.revision);
  }, 60_000);
  it('keeps commits made in an interrupted destination instead of resetting them', async () => {
    const root = await fixture(); const snapshot = { ...(await captureTransferRepository(root))!, branch: 'detached' };
    const destination = path.join(root, 'received');
    await git(root, 'remote', 'set-url', 'origin', 'https://github.com/autohandai/wrong');
    await expect(createTransferCheckout(snapshot, destination, root)).rejects.toThrow('transferred repository');
    await git(destination, 'config', 'user.email', 'test@autohand.test'); await git(destination, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(destination, 'own.txt'), 'keep my commit');
    await git(destination, 'add', '.'); await git(destination, 'commit', '-m', 'my work');
    const commit = (await git(destination, 'rev-parse', 'HEAD')).trim();
    await git(root, 'remote', 'set-url', 'origin', snapshot.url);
    await expect(createTransferCheckout(snapshot, destination, root)).rejects.toThrow('local commits');
    expect((await git(destination, 'rev-parse', 'HEAD')).trim()).toBe(commit);
    expect(await fs.readFile(path.join(destination, 'own.txt'), 'utf8')).toBe('keep my commit');
  });
});
