/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = indexSource.indexOf(startMarker);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = indexSource.indexOf(endMarker, start + startMarker.length);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return indexSource.slice(start, end);
}

/**
 * Project hooks and settings come from `<workspace>/.autohand/`. Every entry
 * point that runs the agent must load them from the workspace the invocation
 * targets (`--path`), not from wherever the process happened to start.
 */
describe('CLI entry points load workspace overlays from the requested workspace', () => {
  const requestedWorkspaceLoad = /loadConfig\(\s*(?:opts|options)\.config,\s*resolveRequestedWorkspaceRoot\(\s*(?:opts|options)\.path\s*\)/;

  it('uses the requested workspace in the mandatory authentication gate', () => {
    const gate = sliceBetween('// ── Mandatory authentication gate ──', '(opts as any)._authConfig = authConfig;');
    expect(gate).toMatch(requestedWorkspaceLoad);
    expect(gate).not.toMatch(/loadConfig\([^)]*process\.cwd\(\)\)/);
  });

  it('uses the requested workspace when runCLI loads its own config', () => {
    const runCli = sliceBetween('let config = options._authConfig ??', 'const originalWorkspaceRoot = resolveWorkspaceRoot(config, options.path);');
    expect(runCli).toMatch(requestedWorkspaceLoad);
    expect(runCli).not.toMatch(/process\.cwd\(\)/);
  });

  it('uses the requested workspace for resume', () => {
    const resume = sliceBetween('registerResumeCommand(program, {', 'await runCLI({ ...opts, _authConfig: authConfig });');
    expect(resume).toMatch(requestedWorkspaceLoad);
  });

  it('loads workspace overlays for auto mode', () => {
    const autoMode = sliceBetween('async function runAutoMode(', 'const originalWorkspaceRoot = resolveWorkspaceRoot(config, opts.path);');
    expect(autoMode).toMatch(requestedWorkspaceLoad);
  });

  it('loads workspace overlays for patch mode', () => {
    const patchMode = sliceBetween('async function runPatchMode(', 'const originalWorkspaceRoot = resolveWorkspaceRoot(config, opts.path);');
    expect(patchMode).toMatch(requestedWorkspaceLoad);
  });

  it('uses the requested workspace for the goal flag fallback', () => {
    const goal = sliceBetween('async function runGoalFlag(', 'const workspaceRoot = resolveWorkspaceRoot(config, opts.path);');
    expect(goal).toMatch(requestedWorkspaceLoad);
    expect(goal).not.toMatch(/process\.cwd\(\)/);
  });
});

describe('entry points resolve workspace trust before project hooks or MCP servers can start', () => {
  const nonInteractiveTrust = /resolveWorkspaceTrust\(\s*(?:this\.)?config,\s*\{\s*interactive:\s*false\s*\}\s*\)/;

  function sliceOf(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it('asks in runCLI after the workspace safety check and before the runtime is assembled', () => {
    const runCli = sliceOf(indexSource, 'async function runCLI(', 'const runtime: AgentRuntime = {');
    const safety = runCli.indexOf('checkWorkspaceSafety(originalWorkspaceRoot)');
    const trust = runCli.indexOf('resolveWorkspaceTrust(');
    expect(safety).toBeGreaterThanOrEqual(0);
    expect(trust).toBeGreaterThan(safety);
  });

  it('warns without prompting in auto mode before the hook manager exists', () => {
    const autoMode = sliceOf(indexSource, 'async function runAutoMode(', 'const hookManager = new HookManager({');
    expect(autoMode).toMatch(nonInteractiveTrust);
  });

  it('warns without prompting in patch mode before the agent exists', () => {
    const patchMode = sliceOf(indexSource, 'async function runPatchMode(', 'agent = new AutohandAgent(');
    expect(patchMode).toMatch(nonInteractiveTrust);
  });

  it('warns on stderr in RPC mode before the runtime is assembled', () => {
    const rpcSource = readFileSync(new URL('../src/modes/rpc/index.ts', import.meta.url), 'utf8');
    const rpc = sliceOf(rpcSource, '// Load configuration', '// Process --yolo flag BEFORE creating runtime');
    expect(rpc).toMatch(nonInteractiveTrust);
  });

  it('warns on stderr in ACP mode when the adapter first loads config', () => {
    const acpSource = readFileSync(new URL('../src/modes/acp/adapter.ts', import.meta.url), 'utf8');
    const acp = sliceOf(acpSource, 'private async ensureConfig()', 'return this.config;');
    expect(acp).toMatch(nonInteractiveTrust);
  });
});
