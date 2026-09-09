import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PeerError } from './PeerProtocol.js';
import { peerFilesystemErrorCode } from './PeerStorage.js';

export interface PeerProcessProof { pid: number; startedAt: string; processGroupId: number; }
export type PeerProcessState = 'alive' | 'gone' | 'unknown';

function existence(pid: number): PeerProcessState {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return peerFilesystemErrorCode(error) === 'ESRCH' ? 'gone' : 'unknown'; }
}

export async function capturePeerProcess(pid: number, processGroupId = pid): Promise<PeerProcessProof | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || processGroupId <= 1) throw new PeerError('INVALID_PARAMS', 'Invalid managed process identity.');
  if (process.platform === 'linux') {
    try {
      const [record, boot] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8')]);
      const fields = record.slice(record.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) !== processGroupId || !/^\d+$/.test(fields[19] ?? '')) throw new PeerError('RECOVERY_REQUIRED', 'The process does not belong to the reserved process group.');
      return { pid, processGroupId, startedAt: `linux:${boot.trim()}:${fields[19]}` };
    } catch (error) { if (peerFilesystemErrorCode(error) === 'ENOENT') return undefined; throw error; }
  }
  if (process.platform === 'darwin') {
    const record = await new Promise<string | undefined>((resolve, reject) => {
      execFile('/bin/ps', ['-p', String(pid), '-o', 'pid=,pgid=,uid=,lstart='], { encoding: 'utf8', timeout: 2_000, maxBuffer: 8_192, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
        if (error && existence(pid) !== 'gone') reject(new PeerError('RECOVERY_REQUIRED', 'Could not verify managed process identity.'));
        else resolve(stdout.trim() || undefined);
      });
    });
    if (!record) return undefined;
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(record);
    if (!match || Number(match[1]) !== pid || Number(match[2]) !== processGroupId || Number(match[3]) !== process.geteuid?.()) throw new PeerError('RECOVERY_REQUIRED', 'Process ownership or process group could not be verified.');
    return { pid, processGroupId, startedAt: `darwin:${match[4]}` };
  }
  throw new PeerError('UNSUPPORTED_PLATFORM', 'This platform requires a verified process job adapter before resource enforcement can be enabled.');
}

export async function probePeerProcess(proof: PeerProcessProof): Promise<PeerProcessState> {
  if (process.platform === 'win32') return 'unknown';
  if (!Number.isSafeInteger(proof.processGroupId) || proof.processGroupId <= 1) return 'unknown';
  const group = existence(-proof.processGroupId);
  if (group === 'gone') return existence(proof.pid) === 'gone' ? 'gone' : 'unknown';
  if (group === 'unknown') return 'unknown';
  try {
    const current = await capturePeerProcess(proof.pid, proof.processGroupId);
    if (!current) return 'alive';
    return current.startedAt === proof.startedAt ? 'alive' : 'unknown';
  } catch { return 'unknown'; }
}
