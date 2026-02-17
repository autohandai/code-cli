/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for MCP CLI subcommands (autohand mcp add/remove/list)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { PROJECT_DIR_NAME } from '../src/constants.js';

// Use a temp config directory for isolation
const tmpDir = path.join(os.tmpdir(), `autohand-mcp-test-${Date.now()}`);
const configPath = path.join(tmpDir, 'config.json');

describe('MCP CLI subcommands', () => {
  beforeAll(() => {
    // Ensure Ink's nested slice-ansi dependencies resolve ansi-styles v6 under Bun.
    execSync(`node ${path.resolve('scripts/fix-ansi-styles.js')}`, {
      encoding: 'utf8',
      timeout: 15000,
    });
  });

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

  // Helper to run CLI commands against the TypeScript source directly.
  // Uses AUTOHAND_CONFIG env var (which detectConfigPath() checks)
  // to point at the temp config file.
  // Runs src/index.ts instead of dist/index.js so tests work without a prior build step (e.g. in CI).
  function runCli(
    args: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ): { stdout: string; exitCode: number } {
    try {
      const stdout = execSync(
        `bun ${path.resolve('src/index.ts')} ${args}`,
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: options?.cwd,
          env: {
            ...process.env,
            AUTOHAND_CONFIG: configPath,
            ...(options?.env ?? {}),
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
        args: ['-y', 'test-mcp@latest'],
        autoConnect: true,
      });
    });

    it('is idempotent when adding same config twice', () => {
      runCli('mcp add test-server npx test-mcp@latest');

      // Same name + same command/args → success, "already configured"
      const result = runCli('mcp add test-server npx test-mcp@latest');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('already configured');

      // Config still has exactly one entry
      const config = fs.readJsonSync(configPath);
      expect(config.mcp.servers).toHaveLength(1);
    });

    it('updates existing server when config differs', () => {
      runCli('mcp add test-server npx test-mcp@latest');

      // Same name but different command → updates in-place
      const result = runCli('mcp add test-server npx other-mcp@latest');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Updated');

      // Config still has one entry with the new command args
      const config = fs.readJsonSync(configPath);
      expect(config.mcp.servers).toHaveLength(1);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'test-server',
        command: 'npx',
        args: ['-y', 'other-mcp@latest'],
      });
    });

    it('handles multiple args correctly', () => {
      runCli('mcp add multi-arg npx @mcp/server@latest arg1 arg2');

      const config = fs.readJsonSync(configPath);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'multi-arg',
        command: 'npx',
        args: ['-y', '@mcp/server@latest', 'arg1', 'arg2'],
      });
    });

    it('adds an HTTP transport server', () => {
      const result = runCli('mcp add --transport http context7 https://mcp.context7.com/mcp');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added "context7"');
      expect(result.stdout).toContain('http');

      const config = fs.readJsonSync(configPath);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'context7',
        transport: 'http',
        url: 'https://mcp.context7.com/mcp',
        autoConnect: true,
      });
    });

    it('rejects SSE transport from CLI add', () => {
      const result = runCli('mcp add --transport sse my-sse http://localhost:3001/mcp');

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('not implemented');
    });

    it('accepts explicit user scope on mcp add', () => {
      const result = runCli('mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added "chrome-devtools"');
      expect(result.stdout).toContain('user config');

      const config = fs.readJsonSync(configPath);
      expect(config.mcp?.servers).toHaveLength(1);
      expect(config.mcp.servers[0]).toMatchObject({
        name: 'chrome-devtools',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
      });
    });

    it('writes to project config when scope is project', () => {
      const projectRoot = path.join(tmpDir, 'project');
      fs.ensureDirSync(projectRoot);

      const result = runCli(
        'mcp add project-only --scope project npx test-mcp@latest',
        { cwd: projectRoot }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('project config');

      const userConfig = fs.readJsonSync(configPath);
      expect(userConfig.mcp?.servers ?? []).toHaveLength(0);

      const projectConfigPath = path.join(projectRoot, PROJECT_DIR_NAME, 'config.json');
      const projectConfig = fs.readJsonSync(projectConfigPath);
      expect(projectConfig.mcp?.servers).toHaveLength(1);
      expect(projectConfig.mcp.servers[0]).toMatchObject({
        name: 'project-only',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'test-mcp@latest'],
      });
    });

    it('rejects invalid scope values', () => {
      const result = runCli('mcp add test-server --scope workspace npx test-mcp@latest');

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Invalid scope');
      expect(result.stdout).toContain('user or project');
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
      expect(result.stdout).toContain('Configured MCP Servers (2, user config)');
    });
  });
});
