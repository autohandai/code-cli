/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The per-run tool scope from `--allowed-tools` and `--disallowed-tools`.
 * It is a restriction layered on top of every configured policy: it is never
 * merged into settings, never persisted, and never widened by a local or
 * extension allowlist. Names are matched against the raw tool the model
 * called, before any capability mapping.
 */
import { parsePermissionToolInputs } from './cliPolicyMutation.js';
import { matchesToolPattern, type ToolPattern } from './toolPatterns.js';

export interface RunToolScope {
  /** When non-empty, only tools named here may be advertised or run. */
  allowed: ToolPattern[];
  /** Tools named here are never advertised (bare) or run (any pattern). */
  denied: ToolPattern[];
}

export function resolveRunToolScope(options: { allowedTools?: string[]; disallowedTools?: string[] } | undefined): RunToolScope | undefined {
  const allowed = parsePermissionToolInputs(options?.allowedTools ?? []);
  const denied = parsePermissionToolInputs(options?.disallowedTools ?? []);
  return allowed.length === 0 && denied.length === 0 ? undefined : { allowed, denied };
}

/** Whether a tool should be offered to the model at all under the scope. */
export function isToolAdvertisedByScope(scope: RunToolScope | undefined, toolName: string): boolean {
  if (!scope) return true;
  if (scope.denied.some((pattern) => pattern.kind === toolName && !pattern.argument)) return false;
  return scope.allowed.length === 0 || scope.allowed.some((pattern) => pattern.kind === toolName);
}

/**
 * Decision for one concrete call. `target` is the argument the patterns
 * describe (a command line, a path, a URL); an empty target only matches
 * bare patterns.
 */
export function checkRunToolScope(
  scope: RunToolScope | undefined,
  call: { kind: string; target: string },
): { allowed: true } | { allowed: false; reason: 'run_scope_denied' | 'run_scope_not_allowed' } {
  if (!scope) return { allowed: true };
  if (scope.denied.some((pattern) => matchesToolPattern(pattern, call))) return { allowed: false, reason: 'run_scope_denied' };
  if (scope.allowed.length > 0 && !scope.allowed.some((pattern) => matchesToolPattern(pattern, call))) {
    return { allowed: false, reason: 'run_scope_not_allowed' };
  }
  return { allowed: true };
}

export function describeRunScopeRefusal(toolName: string, reason: 'run_scope_denied' | 'run_scope_not_allowed'): string {
  return reason === 'run_scope_denied'
    ? `Tool '${toolName}' is disabled for this run by --disallowed-tools.`
    : `Tool '${toolName}' is outside the --allowed-tools scope for this run.`;
}
