/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RenderOptions } from 'ink';

export function inkRenderOptions(options: RenderOptions): RenderOptions {
  return {
    maxFps: 60,
    ...options,
  };
}
