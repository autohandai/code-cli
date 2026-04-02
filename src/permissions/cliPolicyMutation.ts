import YAML from 'yaml';
import type { PermissionSettings } from './types.js';
import type { ToolPattern } from './toolPatterns.js';
import { parseToolPattern } from './toolPatterns.js';

function normalizePatternEntries(entries: unknown): string[] {
  if (typeof entries === 'string') {
    return entries
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (Array.isArray(entries)) {
    return entries
      .flatMap((entry) => normalizePatternEntries(entry))
      .filter(Boolean);
  }

  return [];
}

function parseOneInput(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return normalizePatternEntries(JSON.parse(trimmed));
    } catch {
      return normalizePatternEntries(trimmed);
    }
  }

  if (trimmed.includes('\n') || trimmed.startsWith('- ')) {
    try {
      return normalizePatternEntries(YAML.parse(trimmed));
    } catch {
      return normalizePatternEntries(trimmed);
    }
  }

  return normalizePatternEntries(trimmed);
}

export function parsePermissionToolInputs(values: string[]): ToolPattern[] {
  return values
    .flatMap((value) => parseOneInput(value))
    .map((value) => parseToolPattern(value))
    .filter((pattern) => Boolean(pattern.kind));
}

export function applyPermissionPolicyUpdates(
  settings: PermissionSettings | undefined,
  updates: {
    availableTools?: ToolPattern[];
    allowPatterns?: ToolPattern[];
    denyPatterns?: ToolPattern[];
    excludedTools?: ToolPattern[];
  }
): PermissionSettings {
  return {
    ...(settings ?? {}),
    ...(updates.availableTools ? { availableTools: updates.availableTools } : {}),
    ...(updates.allowPatterns ? { allowPatterns: updates.allowPatterns } : {}),
    ...(updates.denyPatterns ? { denyPatterns: updates.denyPatterns } : {}),
    ...(updates.excludedTools ? { excludedTools: updates.excludedTools } : {}),
  };
}
