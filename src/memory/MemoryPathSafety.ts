/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const SAFE_MEMORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function isSafeMemoryId(memoryId: string): boolean {
  return SAFE_MEMORY_ID.test(memoryId) && !memoryId.includes('..');
}

export function assertSafeMemoryId(memoryId: string): void {
  if (!isSafeMemoryId(memoryId)) {
    throw new Error(`Invalid memory identifier: ${memoryId}`);
  }
}
