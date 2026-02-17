/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeMcpCommandForSpawn,
  normalizeMcpCommandForConfig,
  isNpxCommand,
  isRetriableNpxInstallError,
  buildNpxIsolatedCacheEnv,
} from '../src/mcp/commandNormalization.js';

describe('MCP command normalization', () => {
  it('adds -y to npx commands when missing', () => {
    const normalized = normalizeMcpCommandForSpawn('npx', ['chrome-devtools-mcp@latest']);
    expect(normalized).toEqual({
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    });
  });

  it('does not duplicate existing -y flag', () => {
    const normalized = normalizeMcpCommandForSpawn('npx', ['-y', 'chrome-devtools-mcp@latest']);
    expect(normalized).toEqual({
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    });
  });

  it('does not modify non-npx commands', () => {
    const normalized = normalizeMcpCommandForSpawn('node', ['server.js']);
    expect(normalized).toEqual({
      command: 'node',
      args: ['server.js'],
    });
  });

  it('normalizes npx.cmd command name', () => {
    const normalized = normalizeMcpCommandForSpawn('npx.cmd', ['pkg@latest']);
    expect(normalized).toEqual({
      command: 'npx.cmd',
      args: ['-y', 'pkg@latest'],
    });
  });

  it('keeps undefined config command unchanged', () => {
    const normalized = normalizeMcpCommandForConfig(undefined, ['arg']);
    expect(normalized).toEqual({
      command: undefined,
      args: ['arg'],
    });
  });

  it('detects npx command names across platforms', () => {
    expect(isNpxCommand('npx')).toBe(true);
    expect(isNpxCommand('npx.cmd')).toBe(true);
    expect(isNpxCommand('/usr/local/bin/npx')).toBe(true);
    expect(isNpxCommand('C:\\Program Files\\nodejs\\npx.cmd')).toBe(true);
    expect(isNpxCommand('node')).toBe(false);
  });

  it('detects retriable npm ENOTEMPTY startup errors', () => {
    expect(isRetriableNpxInstallError('npm error code ENOTEMPTY')).toBe(true);
    expect(isRetriableNpxInstallError('ENOTEMPTY: directory not empty .../.npm/_npx/...')).toBe(true);
    expect(isRetriableNpxInstallError('npm error code E404')).toBe(false);
  });

  it('builds isolated npm cache env for retry', () => {
    const env = buildNpxIsolatedCacheEnv({ PATH: '/usr/bin', npm_config_cache: '/old' }, 'chrome-devtools');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.npm_config_cache).toContain('autohand-mcp-npx-cache');
    expect(env.npm_config_cache).toContain('chrome-devtools');
    expect(env.NPM_CONFIG_CACHE).toBe(env.npm_config_cache);
    expect(env.npm_config_cache).not.toBe('/old');
  });
});
