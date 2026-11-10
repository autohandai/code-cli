/** @license Apache-2.0 */
import { open } from 'node:fs/promises';

interface StreamPosition { counter: number; columns: number; rows: number }
interface StreamCommand extends StreamPosition { id: number; action: 'observe' | 'resume' }

async function readCommand(file: string): Promise<unknown> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(513);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 512) throw new Error('Resize stream command exceeded 512 bytes');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}

function parseCommand(value: unknown): StreamCommand {
  if (!value || typeof value !== 'object' || !('id' in value) || !('action' in value) || !('counter' in value)
    || !('columns' in value) || !('rows' in value) || (value.action !== 'observe' && value.action !== 'resume')
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1 || value.id > 8
    || typeof value.counter !== 'number' || !Number.isSafeInteger(value.counter) || value.counter < 0
    || typeof value.columns !== 'number' || !Number.isSafeInteger(value.columns) || value.columns < 1 || value.columns > 10000
    || typeof value.rows !== 'number' || !Number.isSafeInteger(value.rows) || value.rows < 1 || value.rows > 10000) {
    throw new Error('Invalid resize stream command');
  }
  return { id: value.id, action: value.action, counter: value.counter, columns: value.columns, rows: value.rows };
}

export class ResizeStreamGate {
  private command: StreamCommand | undefined;
  private last: StreamPosition | undefined;
  private emittedCommand = 0;
  private paused = false;
  private disposed = false;
  private pending: Promise<void> | undefined;
  private failure: unknown;

  constructor(file: string, private readonly record: (value: object) => void,
    private readonly read: () => Promise<unknown> = () => readCommand(file)) {}

  refresh(): Promise<void> {
    if (this.disposed || this.failure) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.read().then(value => {
      if (this.disposed) return;
      const command = parseCommand(value);
      if (command.id <= (this.command?.id ?? 0)) return;
      this.command = command;
      this.paused = false;
    }).catch(error => {
      if (!this.disposed && !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) this.failure = error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  permits(viewport: Omit<StreamPosition, 'counter'>): boolean {
    if (this.disposed) return false;
    if (this.failure) throw this.failure;
    void this.refresh();
    const command = this.command;
    const last = this.last;
    if (!this.paused && command?.action === 'observe' && last && this.emittedCommand === command.id && last.counter > command.counter
      && (last.columns !== command.columns || last.rows !== command.rows)
      && last.columns === viewport.columns && last.rows === viewport.rows) {
      this.paused = true;
      this.record({ kind: 'stream-gate', command: command.id, ...last, paused: true });
    }
    return !this.paused;
  }

  emitted(position: StreamPosition): void {
    if (this.disposed) return;
    this.last = position;
    this.emittedCommand = this.command?.id ?? 0;
    this.record({ kind: 'stream-chunk', command: this.command?.id ?? 0, ...position, paused: false });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.pending) await this.pending;
  }
}
