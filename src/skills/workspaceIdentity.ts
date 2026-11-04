import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';

const IDENTITY_FILE = 'workspace-identity.json';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export async function readSkillWorkspaceIdentity(workspace: string): Promise<string | null> {
  workspace = path.resolve(workspace);
  if (!await safeDirectory(workspace)) return null;
  const directory = path.join(workspace, '.autohand');
  if (!await safeDirectory(directory)) return null;
  const filename = path.join(directory, IDENTITY_FILE);
  try {
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error('Workspace identity cannot be a symlink.');
    if (!info.isFile() || info.size > 1024) throw new Error('Malformed workspace identity file.');
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > 1024 || current.ino !== info.ino || current.dev !== info.dev) throw new Error('Workspace identity changed while reading.');
      const value: unknown = JSON.parse(await handle.readFile('utf8'));
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('id' in value) || typeof value.id !== 'string' || !UUID.test(value.id)) {
        throw new Error('Malformed workspace identity.');
      }
      return value.id;
    } finally { await handle.close(); }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('Malformed workspace identity JSON.', { cause: error });
    throw error;
  }
}

export async function ensureSkillWorkspaceIdentity(workspace: string): Promise<string> {
  workspace = path.resolve(workspace);
  if (!await safeDirectory(workspace)) throw new Error('Cannot create workspace identity: workspace does not exist.');
  const directory = path.join(workspace, '.autohand');
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
  await safeDirectory(directory);
  const existing = await readSkillWorkspaceIdentity(workspace);
  if (existing) return existing;
  const id = randomUUID();
  const temporary = path.join(directory, `.workspace-identity-${id}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify({ version: 1, id })}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    if (!await safeDirectory(workspace) || !await safeDirectory(directory)) throw new Error('Workspace disappeared during identity creation.');
    try {
      await link(temporary, path.join(directory, IDENTITY_FILE));
      await syncDirectory(directory);
      return id;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const winner = await readSkillWorkspaceIdentity(workspace);
      if (!winner) throw new Error('Workspace identity disappeared during concurrent creation.');
      return winner;
    }
  } finally { await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; }); }
}

async function safeDirectory(directory: string): Promise<boolean> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error('Workspace identity directories cannot be symlinks.');
    if (!info.isDirectory()) throw new Error('Workspace identity requires an existing directory.');
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}
function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF'].includes(errorCode(error) ?? '')) throw error;
  }
}
