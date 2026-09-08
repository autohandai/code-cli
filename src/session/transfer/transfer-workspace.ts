import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
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
  for (const reference of [`refs/remotes/origin/${branch}`, 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/autohand/transfer-base']) {
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

interface CheckoutState { version: 1; fingerprint: string; phase: 'preparing' | 'ready' | 'applied' }
function checkoutRecord(target: string): string { return path.join(path.dirname(target), `.${path.basename(target)}.autohand-transfer.json`); }
function fingerprint(repository: TransferRepository): string { return createHash('sha256').update(JSON.stringify([repository.url, repository.branch, repository.revision, repository.patch])).digest('hex'); }
async function readCheckoutState(target: string, repository: TransferRepository): Promise<CheckoutState | null> {
  try {
    const file = checkoutRecord(target);
    if (!(await fs.lstat(file)).isFile()) { throw new Error('The transfer record is not a regular file. Choose a new directory.'); }
    const state: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!state || typeof state !== 'object' || !('version' in state) || state.version !== 1 || !('fingerprint' in state) || state.fingerprint !== fingerprint(repository)
      || !('phase' in state) || (state.phase !== 'preparing' && state.phase !== 'ready' && state.phase !== 'applied')) {
      throw new Error('This checkout belongs to a different transfer. Choose a new directory.');
    }
    return { version: 1, fingerprint: state.fingerprint, phase: state.phase };
  } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null; } throw error; }
}
async function writeCheckoutState(target: string, state: CheckoutState): Promise<void> {
  const file = checkoutRecord(target), temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

/** Reserve an isolated checkout before Git writes, so an interrupted fetch can be retried. */
export async function createTransferCheckout(repository: TransferRepository, destination: string, existingRepository?: string): Promise<string> {
  const target = path.resolve(destination);
  const url = publicRepositoryUrl(repository.url);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(repository.revision)) { throw new Error('Invalid transfer revision.'); }
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (repository.branch !== 'detached') { await git(path.dirname(target), ['check-ref-format', '--branch', repository.branch]); }
  let state = await readCheckoutState(target, repository);
  if (!state) {
    try { await fs.lstat(target); throw new Error('Choose a new directory for this transferred workspace.'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; } }
    state = { version: 1, fingerprint: fingerprint(repository), phase: 'preparing' };
    try { await fs.writeFile(checkoutRecord(target), JSON.stringify(state), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) { throw error; }
      state = await readCheckoutState(target, repository);
      if (!state) { throw new Error('The checkout reservation changed. Try again.', { cause: error }); }
    }
  }
  try { if (!(await fs.lstat(target)).isDirectory()) { throw new Error('Choose a regular directory for the transferred workspace.'); } }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; } }
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(target);
  if (!entries.includes('.git')) {
    if (entries.length || state.phase !== 'preparing') { throw new Error('The destination changed. Choose a new checkout directory.'); }
    await git(target, ['init']);
  }
  if (!(await fs.lstat(path.join(target, '.git'))).isDirectory()) { throw new Error('The transfer checkout metadata changed. Choose a new directory.'); }
  if (state.phase === 'preparing') {
    let origin = '';
    try { origin = (await git(target, ['config', '--get', 'remote.origin.url'])).trim(); } catch { /* Git init has no remote yet. */ }
    if (!origin) { await git(target, ['remote', 'add', 'origin', url]); }
  }
  if (await transferRepositoryUrl(target) !== url) { throw new Error('The destination repository changed. Choose a new checkout directory.'); }
  if (state.phase === 'applied') { return target; }
  if (state.phase === 'ready') {
    if ((await git(target, ['rev-parse', 'HEAD'])).trim() !== repository.revision) { throw new Error('The destination changed. Keep your local edits and create a new checkout.'); }
    return target;
  }
  if (existingRepository) {
    const origin = publicRepositoryUrl((await git(existingRepository, ['remote', 'get-url', 'origin'])).trim());
    if (origin !== url) { throw new Error('Choose a local checkout of the transferred repository.'); }
  }
  try { await git(target, ['cat-file', '-e', `${repository.revision}^{commit}`]); }
  catch {
    try { await git(target, ['fetch', '--no-tags', '--', existingRepository ? path.resolve(existingRepository) : 'origin', repository.revision]); }
    catch (error) { if (!existingRepository) { throw error; } await git(target, ['fetch', '--no-tags', 'origin', repository.revision]); }
  }
  if ((await git(target, ['status', '--porcelain'])).trim()) { throw new Error('The destination changed. Keep your local edits and create a new checkout.'); }
  let head = ''; try { head = (await git(target, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* The first checkout has no HEAD commit. */ }
  if (head && head !== repository.revision) { throw new Error('The destination changed. Keep your local commits and create a new checkout.'); }
  if (repository.branch === 'detached') { await git(target, ['checkout', '--detach', repository.revision]); }
  else {
    const current = (await git(target, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (head && current !== repository.branch) { throw new Error('The destination changed. Keep your local commits and create a new checkout.'); }
    if (!head) { await git(target, ['checkout', '-b', repository.branch, repository.revision]); }
  }
  await git(target, ['update-ref', 'refs/autohand/transfer-base', repository.revision]);
  await writeCheckoutState(target, { ...state, phase: 'ready' });
  return target;
}

/** Apply only to a clean checkout at the expected base. Git validates paths and the complete patch first. */
export async function applyTransferPatch(repository: TransferRepository, workspace: string): Promise<void> {
  const state = await readCheckoutState(path.resolve(workspace), repository);
  if (state?.phase === 'applied') { return; }
  if ((await git(workspace, ['rev-parse', 'HEAD'])).trim() !== repository.revision) {
    throw new Error('The destination changed. Keep your local edits and create a new checkout for this transfer.');
  }
  if (!repository.patch) { if (state) { await writeCheckoutState(path.resolve(workspace), { ...state, phase: 'applied' }); } return; }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-transfer-patch-'));
  try {
    const file = path.join(temporary, 'changes.patch');
    await fs.writeFile(file, repository.patch, { mode: 0o600 });
    if (state) {
      try {
        await git(workspace, ['apply', '--reverse', '--check', '--binary', '--', file]);
        await writeCheckoutState(path.resolve(workspace), { ...state, phase: 'applied' }); return;
      } catch { /* An unapplied patch still requires a clean checkout. */ }
    }
    if ((await git(workspace, ['status', '--porcelain'])).trim()) { throw new Error('The destination changed. Keep your local edits and create a new checkout for this transfer.'); }
    await git(workspace, ['apply', '--check', '--binary', '--', file]);
    await git(workspace, ['apply', '--binary', '--', file]);
    if (state) { await writeCheckoutState(path.resolve(workspace), { ...state, phase: 'applied' }); }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
