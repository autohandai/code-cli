/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PermissionSettings } from './types.js';

/**
 * Drops tool schemas the permission settings can never authorize, so the
 * model is not offered a tool that every call would then be refused.
 *
 * A pattern with an argument (`run_command(git:*)`) only narrows calls, so
 * the tool stays advertised; a bare pattern names the whole tool.
 */
export function filterAdvertisedTools<T extends { name: string }>(
  definitions: readonly T[],
  settings: Pick<PermissionSettings, 'availableTools' | 'excludedTools'> | undefined,
): T[] {
  const available = settings?.availableTools ?? [];
  const excluded = settings?.excludedTools ?? [];
  if (available.length === 0 && excluded.length === 0) return [...definitions];

  const availableNames = new Set(available.map((pattern) => pattern.kind));
  const excludedNames = new Set(excluded.filter((pattern) => !pattern.argument).map((pattern) => pattern.kind));

  return definitions.filter((definition) => {
    if (excludedNames.has(definition.name)) return false;
    return available.length === 0 || availableNames.has(definition.name);
  });
}
