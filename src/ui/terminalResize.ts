/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WriteStream } from 'node:tty';

type ResizableStream = Pick<WriteStream, 'on' | 'off'> | undefined;

type ResizeCallback = () => void;

/**
 * Watches a TTY stream for resize events and runs the supplied callback.
 */
export class TerminalResizeWatcher {
  private readonly stream: ResizableStream;
  private readonly handler: ResizeCallback;
  private disposed = false;

  constructor(stream: ResizableStream, callback: ResizeCallback) {
    this.stream = stream;
    this.handler = () => {
      if (this.disposed) {
        return;
      }
      callback();
    };
    if (this.stream && typeof this.stream.on === 'function') {
      this.stream.on('resize', this.handler);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.stream && typeof this.stream.off === 'function') {
      this.stream.off('resize', this.handler);
    }
  }
}
