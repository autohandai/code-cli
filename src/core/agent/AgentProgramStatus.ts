/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { shouldWriteTerminalTitle } from '../../ui/terminalTitle.js';

export type ProgramStatusKind = 'permission' | 'question' | 'auth';

interface ProgramStatusFields {
  id?: string;
  app?: string;
  title?: string;
  message?: string;
}

export type ProgramStatusReport = ProgramStatusFields & (
  | { state: 'idle' | 'done' | 'error' | 'clear' }
  | { state: 'working'; progress?: number }
  | { state: 'blocked'; kind: ProgramStatusKind; progress?: number }
);

const currentStatus = new AsyncLocalStorage<AgentProgramStatus>();

function encodeText(value: string, byteLimit: number): string {
  const sanitized = value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  let text = '';
  let bytes = 0;
  for (const character of sanitized) {
    bytes += Buffer.byteLength(character);
    if (bytes > byteLimit) break;
    text += character;
  }
  return Buffer.from(text).toString('base64');
}

export function formatProgramStatus(report: ProgramStatusReport): string {
  const fields = [`state=${report.state}`];
  if (report.id !== undefined) {
    const segments = report.id.split('/');
    if (report.id.length > 128 || segments.length > 8 || segments.some(segment => !/^[A-Za-z0-9_.+-]{1,32}$/.test(segment))) {
      throw new Error('Invalid program status record id');
    }
    fields.push(`id=${report.id}`);
  }
  if (report.app !== undefined) {
    if (!/^[A-Za-z0-9_.+-]{1,32}$/.test(report.app)) throw new Error('Invalid program status app');
    fields.push(`app=${report.app}`);
  }
  if (report.state === 'blocked') fields.push(`kind=${report.kind}`);
  if ((report.state === 'working' || report.state === 'blocked') && report.progress !== undefined) {
    if (!Number.isInteger(report.progress) || report.progress < 0 || report.progress > 100) {
      throw new Error('Program status progress must be an integer from 0 to 100');
    }
    fields.push(`progress=${report.progress}`);
  }
  if (report.title !== undefined) fields.push(`title=${encodeText(report.title, 192)}`);
  if (report.message !== undefined) fields.push(`msg=${encodeText(report.message, 2048)}`);
  return `\x1b]7501;${fields.join(':')}\x1b\\`;
}

export function shouldWriteProgramStatus(argv: readonly string[], isTTY: boolean | undefined): boolean {
  return shouldWriteTerminalTitle(argv, isTTY) && !argv.some((arg, index) => (
    arg.startsWith('-p') || arg === '--prompt' || arg.startsWith('--prompt=')
    || (arg === '--mode' && argv[index + 1] !== 'interactive')
    || (arg.startsWith('--mode=') && arg !== '--mode=interactive')
  ));
}

export interface AgentProgramStatusOptions {
  id: string;
  enabled: boolean;
  write: (sequence: string) => void;
  onChange?: (report: ProgramStatusReport) => void;
}

export class AgentProgramStatus {
  private base: ProgramStatusReport = { state: 'idle' };
  private waits = new Map<symbol, { kind: ProgramStatusKind; message: string }>();
  private activeOperations = 0;
  private lastSequence?: string;
  private disposed = false;
  private cancelled = false;
  private failed = false;
  private exitHandler?: () => void;
  private title?: string;

  constructor(private readonly options: AgentProgramStatusOptions) {}

  start(): void {
    if (this.disposed) return;
    if (this.options.enabled && !this.exitHandler) {
      this.exitHandler = () => this.dispose(false);
      process.on('exit', this.exitHandler);
    }
    this.apply();
  }

  async run<T>(operation: () => Promise<T>, options: { signal?: AbortSignal; message?: string } = {}): Promise<T> {
    if (this.activeOperations === 0) {
      this.cancelled = false;
      this.failed = false;
    }
    this.activeOperations++;
    this.base = { state: 'working', ...(options.message ? { message: options.message } : {}) };
    this.apply();
    let succeeded = false;
    try {
      const result = await currentStatus.run(this, operation);
      succeeded = result !== false;
      return result;
    } finally {
      this.activeOperations--;
      if (this.activeOperations === 0) {
        if (!this.failed || options.signal?.aborted || this.cancelled) {
          this.base = { state: options.signal?.aborted || this.cancelled ? 'idle' : succeeded ? 'done' : 'error' };
        }
      }
      this.apply();
    }
  }

  setTitle(title: string | undefined): void {
    this.title = title;
    if (this.lastSequence !== undefined) this.apply();
  }

  cancel(): void {
    this.cancelled = true;
    this.waits.clear();
    this.base = { state: 'idle' };
    this.apply();
  }

  fail(message: string): void {
    this.failed = true;
    this.waits.clear();
    this.base = { state: 'error', message };
    this.apply();
  }

  prompt<T>(message: string, operation: () => Promise<T>): Promise<T> {
    return this.waits.size ? operation() : this.wait('question', message, operation);
  }

  async wait<T>(kind: ProgramStatusKind, message: string, operation: () => Promise<T>): Promise<T> {
    const token = Symbol();
    this.waits.set(token, { kind, message });
    this.apply();
    try {
      return await currentStatus.run(this, operation);
    } finally {
      this.waits.delete(token);
      this.apply();
    }
  }

  dispose(notify = true): void {
    if (this.disposed) return;
    this.waits.clear();
    this.publish({ state: 'clear' }, notify);
    this.disposed = true;
    if (this.exitHandler) process.off('exit', this.exitHandler);
    this.exitHandler = undefined;
  }

  private apply(): void {
    if (this.disposed) return;
    const wait = [...this.waits.values()].at(-1);
    this.publish(wait ? { state: 'blocked', ...wait } : this.base);
  }

  private publish(report: ProgramStatusReport, notify = true): void {
    const identified = { ...report, ...(this.title ? { title: this.title } : {}), id: this.options.id, app: 'autohand' };
    const sequence = formatProgramStatus(identified);
    if (sequence === this.lastSequence) return;
    this.lastSequence = sequence;
    if (this.options.enabled) {
      try { this.options.write(sequence); } catch { /* Status cannot interrupt work. */ }
    }
    if (notify) {
      try { this.options.onChange?.(identified); } catch { /* Observers cannot interrupt work. */ }
    }
  }
}

export function withProgramStatusWait<T>(kind: ProgramStatusKind, message: string, operation: () => Promise<T>): Promise<T> {
  const status = currentStatus.getStore();
  return status ? status.wait(kind, message, operation) : operation();
}

export function withProgramStatusPrompt<T>(message: string, operation: () => Promise<T>): Promise<T> {
  const status = currentStatus.getStore();
  return status ? status.prompt(message, operation) : operation();
}

export function reportProgramStatusFailure(message: string): void {
  currentStatus.getStore()?.fail(message);
}

export function reportProgramStatusCancellation(): void {
  currentStatus.getStore()?.cancel();
}

export async function withProgramStatusAuthentication<T>(operation: () => Promise<T>): Promise<T> {
  const current = currentStatus.getStore();
  if (current) return current.wait('auth', 'Sign in to continue', operation);
  const status = new AgentProgramStatus({
    id: `autohand-auth-${process.pid}`,
    enabled: shouldWriteProgramStatus(process.argv, process.stdout.isTTY),
    write: sequence => { process.stdout.write(sequence); },
  });
  status.start();
  try {
    return await status.wait('auth', 'Sign in to continue', operation);
  } finally {
    status.dispose();
  }
}
