/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defineStateMachine, StateMachine } from '../utils/stateMachine.js';

export const EXTENSION_RELOAD_LIFECYCLE = defineStateMachine({
  name: 'extension reload',
  initial: 'idle',
  transitions: {
    idle: { start: 'starting', stop: 'stopped' },
    starting: { ready: 'watching', stop: 'stopped' },
    watching: { stop: 'stopped' },
    stopped: {},
  },
});

interface ExtensionReloadOptions {
  roots: string[];
  isIdle(): boolean;
  reload(): Promise<void>;
  onError?(error: unknown): void;
  signal?: AbortSignal;
}

export class ExtensionReloadController {
  private readonly watchers = new Map<string, FSWatcher>();
  private packageRoots: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private dirty = false;
  private sessionOperations = 0;
  private readonly lifecycle = new StateMachine(EXTENSION_RELOAD_LIFECYCLE);
  private startup?: Promise<void>;
  private watcherSync: Promise<void> = Promise.resolve();
  private queuedWatcherSync?: Promise<void>;
  private readonly abort = (): void => { void this.stop(); };

  constructor(private readonly options: ExtensionReloadOptions) {}

  private get stopped(): boolean {
    return this.lifecycle.is('stopped');
  }

  start(): Promise<void> {
    if (this.startup) return this.startup;
    if (this.options.signal?.aborted || !this.lifecycle.trySend('start')) return Promise.resolve();
    this.startup = this.runStartup();
    return this.startup;
  }

  private async runStartup(): Promise<void> {
    this.options.signal?.addEventListener('abort', this.abort, { once: true });
    await Promise.all(this.options.roots.map((root) => fs.mkdir(root, { recursive: true })
      .catch((error: unknown) => this.options.onError?.(error))));
    if (!this.lifecycle.trySend('ready')) return;
    await this.updateWatchers();
  }

  async setPackageRoots(roots: string[]): Promise<void> {
    this.packageRoots = [...new Set(roots)];
    await this.updateWatchers();
  }

  /**
   * Reconciliations run one at a time so an older, slower pass can never close
   * watchers a newer pass created. Requests made while a pass is queued share
   * it; the queued pass reads the roots only when it begins, so it always
   * reflects the latest request.
   */
  private updateWatchers(): Promise<void> {
    if (!this.lifecycle.is('watching')) return Promise.resolve();
    if (this.queuedWatcherSync) return this.queuedWatcherSync;
    const queued = this.watcherSync.then(() => {
      this.queuedWatcherSync = undefined;
      return this.reconcileWatchers();
    });
    this.queuedWatcherSync = queued;
    this.watcherSync = queued.catch(() => {});
    return queued;
  }

  private async reconcileWatchers(): Promise<void> {
    if (!this.lifecycle.is('watching')) return;
    const targets = [...this.options.roots, ...this.packageRoots].map((root) => path.resolve(root));
    const watchedRoots = new Set<string>();
    for (const target of targets) {
      let root = target;
      while (!await fs.stat(root).then((stat) => stat.isDirectory(), () => false)) {
        const parent = path.dirname(root);
        if (parent === root) break;
        root = parent;
      }
      if (this.stopped) return;
      watchedRoots.add(root);
      if (this.watchers.has(root)) continue;
      try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          const relative = filename?.toString();
          if (relative?.split(/[\\/]/).some((part) => part === 'node_modules' || part === '.git'
            || part === '.locks' || /^\.(?:tmp|backup|removed)-/.test(part))) return;
          const changed = path.resolve(root, relative ?? '');
          if (!targets.some((target) => changed === target || changed.startsWith(`${target}${path.sep}`)
            || target.startsWith(`${changed}${path.sep}`))) return;
          this.requestReload();
        });
        watcher.on('error', (error) => {
          watcher.close();
          if (this.watchers.get(root) === watcher) this.watchers.delete(root);
          this.options.onError?.(error);
          this.requestReload();
        });
        watcher.unref();
        this.watchers.set(root, watcher);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    for (const [root, watcher] of this.watchers) {
      if (!watchedRoots.has(root)) {
        watcher.close();
        this.watchers.delete(root);
      }
    }
  }

  private requestReload(delay = 350): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped) return;
      if (this.running || this.sessionOperations > 0 || !this.options.isIdle()) {
        this.requestReload(150);
        return;
      }
      this.dirty = false;
      this.running = this.options.reload().catch((error: unknown) => {
        this.options.onError?.(error);
      }).finally(() => {
        this.running = undefined;
        if (this.dirty) this.requestReload();
      });
    }, delay);
    this.timer.unref?.();
  }

  async withStableExtensions<T>(operation: () => Promise<T>): Promise<T> {
    await this.running;
    this.sessionOperations += 1;
    try {
      return await operation();
    } finally {
      this.sessionOperations -= 1;
    }
  }

  async stop(): Promise<void> {
    this.lifecycle.trySend('stop');
    this.options.signal?.removeEventListener('abort', this.abort);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    await this.running;
  }
}
