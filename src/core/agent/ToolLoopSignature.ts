/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentAction, ToolCallRequest } from '../../types.js';

export interface ToolLoopResult {
  tool: AgentAction['type'];
  success: boolean;
  output?: string;
  error?: string;
}

export function buildToolLoopCallSignature(calls: ToolCallRequest[]): string {
  return calls
    .map((call) => {
      const args = call.args === undefined ? '' : stableSerializeForLoop(call.args);
      return `${call.tool}:${args}`;
    })
    .sort()
    .join('|');
}

export function getToolCallLabel(call: { tool: string; args?: Record<string, unknown> }): string {
  const args = call.args ?? {};

  if (args.path) return String(args.path);
  if (args.file_path) return String(args.file_path);

  if (args.command) {
    const cmd = String(args.command);
    const cmdArgs = Array.isArray(args.args) ? args.args.join(' ') : '';
    return cmdArgs ? `${cmd} ${cmdArgs}` : cmd;
  }

  if (args.query) return String(args.query);
  if (args.pattern) return String(args.pattern);
  if (args.task) return String(args.task).slice(0, 60);

  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) return val.slice(0, 80);
  }

  return call.tool;
}

export function buildToolLoopResultSignature(results: ToolLoopResult[]): string {
  return results
    .map((result) => {
      const payload = result.success ? result.output : (result.error ?? result.output ?? '');
      const normalized = normalizeToolLoopText(payload);
      return `${result.tool}:${result.success ? 'ok' : 'err'}:${normalized}`;
    })
    .sort()
    .join('|');
}

export function truncateToolLoopSignature(signature: string, maxLength = 180): string {
  if (signature.length <= maxLength) {
    return signature;
  }
  return `${signature.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stableSerializeForLoop(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((entry) => normalize(entry));
    }
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        normalized[key] = normalize(record[key]);
      }
      return normalized;
    }
    return input;
  };

  try {
    const serialized = JSON.stringify(normalize(value));
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeToolLoopText(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}
