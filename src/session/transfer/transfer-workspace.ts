import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { publicRepositoryUrl, TRANSFER_MAX_BYTES, type TransferRepository } from './session-transfer.js';

const execute = promisify(execFile);
async function git(cwd: string, args: string[], index?: string): Promise<string> {
  const result = await execute('git', args, { cwd, env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) },
    maxBuffer: TRANSFER_MAX_BYTES, timeout: 60_000, encoding: 'utf8' });
  return result.stdout;
}

export async function transferRepositoryUrl(workspace: string): Promise<string | null> {
  try { return publicRepositoryUrl((await git(workspace, ['remote', 'get-url', 'origin'])).trim()); }
  catch { return null; }
}

/** Capture staged, unstaged, and non-ignored new files without touching the real index. */
export async function captureTransferRepository(workspace: string): Promise<TransferRepository | null> {
  let root: string;
  try { root = (await git(workspace, ['rev-parse', '--show-toplevel'])).trim(); }
  catch { return null; }
  const url = publicRepositoryUrl((await git(root, ['remote', 'get-url', 'origin'])).trim());
  const branch = (await git(root, ['branch', '--show-current'])).trim() || 'detached';
  let revision = '';
  // A local-only commit is carried in the patch. The destination must be able
  // to obtain the base from the remote without a push from the source machine.
  for (const reference of [`refs/remotes/origin/${branch}`, 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    try { revision = (await git(root, ['merge-base', 'HEAD', reference])).trim(); if (revision) { break; } }
    catch { /* Try the next known remote branch. */ }
  }
  if (!revision) { throw new Error('Fetch this repository’s remote branches before transferring its changes.'); }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-transfer-index-'));
  try {
    const index = path.join(temporary, 'index');
    await git(root, ['read-tree', 'HEAD'], index);
    await git(root, ['add', '--all', '--', '.'], index);
    const patch = await git(root, ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', revision, '--'], index);
    return { url, branch, revision, patch };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

/** Prepare a separate checkout so receiving a transfer cannot overwrite local work. */
export async function createTransferCheckout(repository: TransferRepository, destination: string, existingRepository?: string): Promise<string> {
  const target = path.resolve(destination);
  try { await fs.lstat(target); throw new Error('Choose a new directory for this transferred workspace.'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; } }
  const url = publicRepositoryUrl(repository.url);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(repository.revision)) { throw new Error('Invalid transfer revision.'); }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (existingRepository) {
    const origin = publicRepositoryUrl((await git(existingRepository, ['remote', 'get-url', 'origin'])).trim());
    if (origin !== url) { throw new Error('Choose a local checkout of the transferred repository.'); }
    try { await git(existingRepository, ['cat-file', '-e', `${repository.revision}^{commit}`]); }
    catch { await git(existingRepository, ['fetch', '--no-tags', 'origin', repository.revision]); }
    await git(existingRepository, ['worktree', 'add', '--detach', target, repository.revision]);
  } else {
    await git(path.dirname(target), ['clone', '--no-checkout', '--', url, target]);
    await git(target, ['checkout', '--detach', repository.revision]);
  }
  return target;
}

/** Apply only to a clean checkout at the expected base. Git validates paths and the complete patch first. */
export async function applyTransferPatch(repository: TransferRepository, workspace: string): Promise<void> {
  if (!repository.patch) { return; }
  if ((await git(workspace, ['rev-parse', 'HEAD'])).trim() !== repository.revision || (await git(workspace, ['status', '--porcelain'])).trim()) {
    throw new Error('The destination changed. Keep your local edits and create a new checkout for this transfer.');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-transfer-patch-'));
  try {
    const file = path.join(temporary, 'changes.patch');
    await fs.writeFile(file, repository.patch, { mode: 0o600 });
    await git(workspace, ['apply', '--check', '--binary', '--', file]);
    await git(workspace, ['apply', '--binary', '--', file]);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
