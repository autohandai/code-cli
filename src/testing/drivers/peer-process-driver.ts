import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PeerDescriptor } from '../../session/peers/PeerProtocol.js';

export class PeerProcessDriver {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private stderr = '';
  self!: PeerDescriptor;

  async launch(options: { home: string; workspaceRoot: string; alias: string; executable?: string; entry?: string }): Promise<void> {
    const entry = options.entry ?? path.resolve(import.meta.dirname, '../scenarios/peerProcessScenario.ts');
    const child = spawn(options.executable ?? 'bun', [entry, options.home, options.workspaceRoot, options.alias], { stdio: 'pipe' });
    this.child = child;
    child.stderr.on('data', data => { this.stderr += String(data); });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Peer did not start: ${this.stderr}`)), 10_000);
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        const message = JSON.parse(line) as { ready?: PeerDescriptor; id?: string; result?: unknown; error?: { message: string; code?: string } };
        if (message.ready) {
          this.self = message.ready;
          clearTimeout(timeout);
          resolve();
          return;
        }
        const waiter = message.id ? this.pending.get(message.id) : undefined;
        if (!waiter || !message.id) return;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else waiter.resolve(message.result);
      });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => {
        clearTimeout(timeout);
        const error = new Error(`Peer fixture exited (${code}): ${this.stderr}`);
        reject(error);
        for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
        this.pending.clear();
      });
    });
    try { await ready; }
    catch (error) { child.kill('SIGTERM'); await this.waitForExit(); throw error; }
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Peer fixture timed out: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.child?.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async close(): Promise<void> {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
    await this.request('shutdown').catch(() => {});
    this.child.stdin.end();
    await this.waitForExit();
  }

  private async waitForExit(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  crash(): void { this.child?.kill('SIGKILL'); }
}
