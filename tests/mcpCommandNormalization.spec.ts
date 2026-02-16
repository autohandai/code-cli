/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeMcpCommandForSpawn,
  normalizeMcpCommandForConfig,
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
});
