import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import type { PermissionContext } from './types.js';

/** Matching semantics retained for newly imported rules; existing globs keep their meaning. */
export interface ImportedClaudeRule {
  pattern: string;
  action: 'allow' | 'deny';
  kind: 'command-prefix' | 'command-exact' | 'file' | 'tool';
}

/** Resolve existing parents too, so writes to a new file cannot bypass an alias. */
function resolvedPath(file: string): string | null {
  let parent = file;
  const missing: string[] = [];
  while (true) {
    try { return path.join(realpathSync.native(parent), ...missing); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
      try { if (lstatSync(parent).isSymbolicLink()) return null; } catch { /* A missing child is resolved against its nearest existing parent. */ }
      const next = path.dirname(parent);
      if (next === parent) return null;
      missing.unshift(path.basename(parent));
      parent = next;
    }
  }
}

export function matchesImportedClaudeRule(context: PermissionContext, rule: ImportedClaudeRule, workspaceRoot?: string): boolean {
  const colon = rule.pattern.indexOf(':');
  if (colon < 0 || rule.pattern.slice(0, colon) !== context.tool) return false;
  const target = rule.pattern.slice(colon + 1);
  if (rule.kind === 'tool') return target === '*';
  if (rule.kind === 'file') {
    if (!context.path) return false;
    const root = path.resolve(workspaceRoot ?? process.cwd());
    const realRoot = resolvedPath(root);
    if (!realRoot) return rule.action === 'deny';
    const canonical = (value: string) => {
      const full = path.resolve(root, value);
      return full === root || full.startsWith(root + path.sep) ? path.resolve(realRoot, path.relative(root, full)) : full;
    };
    const requested = canonical(context.path);
    const resolved = resolvedPath(requested);
    if (!resolved) return rule.action === 'deny';
    const matches = (value: string) => {
      if (target === '**' || target.endsWith('/**')) {
        const directory = canonical(target === '**' ? '.' : target.slice(0, -3));
        return value === directory || value.startsWith(directory + path.sep);
      }
      return value === canonical(target);
    };
    return rule.action === 'deny' ? matches(requested) || matches(resolved) : matches(requested) && matches(resolved);
  }
  if (!context.command) return false;
  const command = [context.command, ...(context.args ?? [])].join(' ');
  if (rule.kind === 'command-exact') return command === target;
  const prefix = target.endsWith('*') ? target.slice(0, -1) : target;
  return command === prefix || command.startsWith(prefix + ' ');
}
