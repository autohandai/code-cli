/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for MCP CLI subcommands (autohand mcp add/remove/list)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

// Use a temp config directory for isolation
const tmpDir = path.join(os.tmpdir(), `autohand-mcp-test-${Date.now()}`);
const configPath = path.join(tmpDir, 'config.json');

describe('MCP CLI subcommands', () => {
  beforeEach(async () => {
    await fs.ensureDir(tmpDir);
    // Write a minimal config
    await fs.writeJson(configPath, {
      openrouter: { apiKey: 'test-key' },
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // Helper to run CLI commands against the local build.
  // Uses AUTOHAND_CONFIG env var (which detectConfigPath() checks)
  // to point at the temp config file.
  function runCli(args: string): { stdout: string; exitCode: number } {
    try {
      const stdout = execSync(
        `bun ${path.resolve('dist/index.js')} ${args}`,
        {
          encoding: 'utf8',
          timeout: 15000,
          env: {
            ...process.env,
            AUTOHAND_CONFIG: configPath,
          },
        }
      );
      return { stdout, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: (error.stdout?.toString() ?? '') + (error.stderr?.toString() ?? ''),
        exitCode: error.status ?? 1,
      };
    }
  }

  describe('mcp add', () => {
    it('adds a new server to config', () => {
      const result = runCli('mcp add test-server npx test-mcp@latest');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added "test-server"');
      expect(result.stdout).toContain('auto-connect');

      // Verify config was written
      const config = fs.readJsonSync(configPath);
      expect(config.mcp?.servers).toHaveLength(1);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'test-server',
        transport: 'stdio',
        command: 'npx',
        args: ['test-mcp@latest'],
        autoConnect: true,
      });
    });

    it('rejects duplicate server names', () => {
      // Add the first server
      runCli('mcp add test-server npx test-mcp@latest');

      // Try to add with same name
      const result = runCli('mcp add test-server npx other-mcp@latest');

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('already exists');
    });

    it('handles multiple args correctly', () => {
      runCli('mcp add multi-arg npx @mcp/server@latest arg1 arg2');

      const config = fs.readJsonSync(configPath);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'multi-arg',
        command: 'npx',
        args: ['@mcp/server@latest', 'arg1', 'arg2'],
      });
    });
  });

  describe('mcp remove', () => {
    it('removes an existing server from config', () => {
      // Add first
      runCli('mcp add test-server npx test-mcp@latest');

      // Remove
      const result = runCli('mcp remove test-server');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Removed "test-server"');

      const config = fs.readJsonSync(configPath);
      expect(config.mcp?.servers ?? []).toHaveLength(0);
    });

    it('returns error for non-existent server', () => {
      const result = runCli('mcp remove nonexistent');

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('not found');
    });
  });

  describe('mcp list', () => {
    it('shows no servers when none configured', () => {
      const result = runCli('mcp list');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No MCP servers configured');
    });

    it('shows configured servers', () => {
      runCli('mcp add chrome-devtools npx chrome-devtools-mcp@latest');
      runCli('mcp add filesystem npx @mcp/filesystem');

      const result = runCli('mcp list');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('chrome-devtools');
      expect(result.stdout).toContain('filesystem');
      expect(result.stdout).toContain('Configured MCP Servers (2)');
    });
  });
});
