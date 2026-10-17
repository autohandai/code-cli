/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RenderOptions } from 'ink';

export function inkRenderOptions(options: RenderOptions): RenderOptions {
  return options;
}

type WriteCallback = (error?: Error | null) => void;

export function createScrollbackPreservingOutput(output: NodeJS.WriteStream): NodeJS.WriteStream {
  const write = (chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback): boolean => {
    const content = typeof chunk === 'string' ? chunk.replaceAll('\x1b[3J', '') : chunk;
    if (typeof encodingOrCallback === 'function') return output.write(content, encodingOrCallback);
    if (encodingOrCallback) return output.write(content, encodingOrCallback, callback);
    return output.write(content, callback);
  };

  return new Proxy(output, {
    get(target, property) {
      if (property === 'write') return write;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
