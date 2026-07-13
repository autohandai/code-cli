/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { MobileKeepAwakeStatus } from './MobileHandoffClient.js';

export type KeepAwakeState = MobileKeepAwakeStatus;

export type KeepAwakeProcessFactory = () => ChildProcess;

function defaultProcessFactory(): ChildProcess {
  return spawn('/usr/bin/caffeinate', ['-dims', '-w', String(process.pid)], {
    stdio: 'ignore',
  });
}

export class KeepAwakeController {
  private child: ChildProcess | null = null;
  private state: KeepAwakeState;

  constructor(
    platform: NodeJS.Platform = process.platform,
    private readonly processFactory: KeepAwakeProcessFactory = defaultProcessFactory
  ) {
    this.state = platform === 'darwin'
      ? { supported: true, enabled: false }
      : { supported: false, enabled: false, reason: 'Keep awake currently requires macOS' };
  }

  currentState(): KeepAwakeState {
    return { ...this.state };
  }

  enable(): KeepAwakeState {
    if (!this.state.supported || this.child) return this.currentState();

    try {
      const child = this.processFactory();
      this.child = child;
      this.state = { supported: true, enabled: true };
      child.once('error', (error) => {
        if (this.child !== child) return;
        this.child = null;
        this.state = { supported: true, enabled: false, reason: error.message };
      });
      child.once('exit', () => {
        if (this.child !== child) return;
        this.child = null;
        this.state = { supported: true, enabled: false };
      });
      child.unref();
    } catch (error) {
      this.child = null;
      this.state = {
        supported: true,
        enabled: false,
        reason: (error as Error).message,
      };
    }
    return this.currentState();
  }

  disable(): KeepAwakeState {
    const child = this.child;
    this.child = null;
    child?.kill('SIGTERM');
    this.state = this.state.supported
      ? { supported: true, enabled: false }
      : this.state;
    return this.currentState();
  }

  dispose(): void {
    this.disable();
  }
}
