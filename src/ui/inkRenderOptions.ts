/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RenderOptions } from 'ink';

type AutohandRenderOptions = RenderOptions & {
  concurrent?: boolean;
};

export function inkRenderOptions(options: AutohandRenderOptions): RenderOptions {
  return options;
}
