import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { PeerError } from './PeerProtocol.js';

export function peerFilesystemErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

export async function ensurePrivatePeerDirectory(directory: string): Promise<string> {
  const absolute = path.resolve(directory);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new PeerError('UNSAFE_ENDPOINT', 'Peer state must use a real private directory.');
  if (process.platform === 'win32') throw new PeerError('UNSUPPORTED_PLATFORM', 'Windows peer IPC requires the verified current-user ACL adapter.');
  if (info.uid !== process.geteuid?.()) throw new PeerError('UNSAFE_ENDPOINT', 'The peer directory is owned by another OS user.');
  if ((info.mode & 0o777) !== 0o700) await chmod(absolute, 0o700);
  const verified = await lstat(absolute);
  if (verified.isSymbolicLink() || verified.uid !== info.uid || verified.ino !== info.ino || (verified.mode & 0o777) !== 0o700) throw new PeerError('UNSAFE_ENDPOINT', 'Peer directory ownership changed during validation.');
  return realpath(absolute);
}

export async function readPrivatePeerFile(filename: string, maxBytes: number): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || process.platform !== 'win32' && (info.uid !== process.geteuid?.() || (info.mode & 0o077) !== 0)) throw new PeerError('UNSAFE_ENDPOINT', 'Peer state is not a private file owned by this OS user.');
    if (info.size > maxBytes) throw new PeerError('RECOVERY_REQUIRED', 'Peer state exceeds its bounded storage limit.');
    return await handle.readFile('utf8');
  } catch (error) {
    if (peerFilesystemErrorCode(error) === 'ENOENT') return undefined;
    if (['ELOOP', 'EMLINK'].includes(peerFilesystemErrorCode(error) ?? '')) throw new PeerError('UNSAFE_ENDPOINT', 'Symlink peer state is not allowed.');
    throw error;
  } finally { await handle?.close(); }
}
